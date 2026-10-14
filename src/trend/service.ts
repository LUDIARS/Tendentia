// 巡回の手順: 有効なソースを順に取得して履歴に残す → 古い履歴と開いた記録を消す。 LLM は使わない。
// 1 ソースの失敗は他を止めず、 失敗として記録する (画面には前回成功分を出し続ける)。
// 同じサイトへは間隔を空けて取りに行く (host-pacer.ts)。

import type BetterSqlite3 from 'better-sqlite3';
import { getTrendCrawlerConfig } from './config.ts';
import { fetchTrendSource, type FetchSourceDeps } from './sources/fetch-source.ts';
import { HostPacer, interleaveByHost } from './host-pacer.ts';
import { CLICK_WINDOW_DAYS, pruneClicksBefore } from './interest-store.ts';
import { pruneUserClicksBefore } from './personal-store.ts';
import { pruneSnapshotsBefore, recordSnapshot } from './store.ts';
import type { RawTrendItem, TrendCrawlResult, TrendSource } from './types.ts';

type Db = BetterSqlite3.Database;

export type TrendFetcher = (source: TrendSource, limit: number) => Promise<RawTrendItem[]>;

export interface TrendCrawlDeps {
  fetchSource?: TrendFetcher;
  pacer?: HostPacer;
}

const DAY_MS = 24 * 60 * 60 * 1000;

function errorMessage(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).slice(0, 400);
}

export async function crawlTrends(
  db: Db,
  now: Date = new Date(),
  deps: TrendCrawlDeps = {},
  onlySourceId?: string,
): Promise<TrendCrawlResult> {
  const config = getTrendCrawlerConfig(db);
  const fetchSource = deps.fetchSource ?? ((source: TrendSource, limit: number) => fetchTrendSource(source, limit, { now } satisfies FetchSourceDeps));
  const targets = interleaveByHost(config.sources.filter((source) => source.enabled && (onlySourceId === undefined || source.id === onlySourceId)));
  const pacer = deps.pacer ?? new HostPacer();
  const crawledAt = now.toISOString();
  const failed: TrendCrawlResult['failed'] = [];
  let ok = 0;

  for (const source of targets) {
    try {
      await pacer.wait(source.url);
      const items = (await fetchSource(source, config.itemsPerSource)).slice(0, config.itemsPerSource);
      if (items.length === 0) throw new Error('一覧が空でした');
      recordSnapshot(db, { sourceId: source.id, genre: source.genre, fetchedAt: crawledAt, ok: true, error: null, items });
      ok += 1;
    } catch (error: unknown) {
      const message = errorMessage(error);
      recordSnapshot(db, { sourceId: source.id, genre: source.genre, fetchedAt: crawledAt, ok: false, error: message, items: [] });
      failed.push({ sourceId: source.id, error: message });
    }
  }

  pruneSnapshotsBefore(db, new Date(now.getTime() - config.retentionDays * DAY_MS).toISOString());
  const clickCutoff = new Date(now.getTime() - CLICK_WINDOW_DAYS * DAY_MS).toISOString();
  pruneClicksBefore(db, clickCutoff);
  pruneUserClicksBefore(db, clickCutoff);

  return { crawledAt, ok, failed };
}
