// viewer 側: collector (本社) の GET /api/sync/export を、 自分が持っている位置より後から続きが無くなるまで取りに行く。
// 取り込みのあと、 写した巡回の設定の保持日数で古い履歴を消す (collector と同じ期間だけ持つ)。

import type BetterSqlite3 from 'better-sqlite3';
import { getTrendCrawlerConfig } from '../config.ts';
import { CLICK_WINDOW_DAYS } from '../interest-store.ts';
import { pruneUserClicksBefore } from '../personal-store.ts';
import { pruneSnapshotsBefore } from '../store.ts';
import { applySyncExport, localCursor, parseSyncExport, saveLocalCursor } from './import.ts';
import type { SyncResult } from './types.ts';

type Db = BetterSqlite3.Database;

export type SyncFetch = (url: string) => Promise<unknown>;

/** 1 回の取り込みで取りに行くページの上限 (初回でも 200 × 50 = 1 万回分の巡回まで)。 */
const MAX_PAGES = 50;
const DAY_MS = 24 * 60 * 60 * 1000;

const defaultFetch: SyncFetch = async (url) => {
  const response = await fetch(url, { signal: AbortSignal.timeout(30_000), headers: { accept: 'application/json' } });
  if (!response.ok) throw new Error(`本社の Tendentia が HTTP ${response.status} を返しました`);
  return response.json();
};

export function exportUrl(upstream: string, afterSnapshot: number): string {
  const url = new URL('/api/sync/export', upstream);
  url.searchParams.set('after', String(afterSnapshot));
  return url.toString();
}

export async function pullFromUpstream(db: Db, upstream: string, now: Date = new Date(), fetchJson: SyncFetch = defaultFetch): Promise<SyncResult> {
  const result: SyncResult = { pages: 0, snapshots: 0, items: 0 };
  let cursor = localCursor(db);
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const data = parseSyncExport(await fetchJson(exportUrl(upstream, cursor.snapshot)));
    const applied = applySyncExport(db, data);
    result.pages += 1;
    result.snapshots += applied.snapshots;
    result.items += applied.items;
    if (data.cursor.snapshot > cursor.snapshot) saveLocalCursor(db, data.cursor);
    if (!data.more || data.cursor.snapshot <= cursor.snapshot) break;
    cursor = data.cursor;
  }
  const retentionDays = getTrendCrawlerConfig(db).retentionDays;
  pruneSnapshotsBefore(db, new Date(now.getTime() - retentionDays * DAY_MS).toISOString());
  // viewer は巡回しないので、 ログインした人の開いた記録の古い分もここで消す。
  pruneUserClicksBefore(db, new Date(now.getTime() - CLICK_WINDOW_DAYS * DAY_MS).toISOString());
  return result;
}

/** 10 分おきに取りに行く。 失敗しても次の回でまた試す (画面は持っている分を出し続ける)。 */
export const PULL_INTERVAL_MS = 10 * 60 * 1000;

export function startReplicaPuller(db: Db, upstream: string): void {
  let running = false;
  const tick = async (): Promise<void> => {
    if (running) return;
    running = true;
    try {
      const result = await pullFromUpstream(db, upstream);
      if (result.snapshots > 0) console.log(`[tendentia] replicated ${result.snapshots} snapshots / ${result.items} items from ${upstream}`);
    } catch (error: unknown) {
      console.warn('[tendentia] replication failed:', error instanceof Error ? error.message : String(error));
    } finally {
      running = false;
    }
  };
  setTimeout(() => { void tick(); }, 5_000).unref?.();
  setInterval(() => { void tick(); }, PULL_INTERVAL_MS).unref?.();
}
