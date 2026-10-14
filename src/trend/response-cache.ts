// 一覧とマップの応答 (JSON の文字列) を覚えておき、 データが変わっていなければ組み立て直さずに返す
// (2026-10-14 neco「キャッシュして返す速度を早くする」)。 一覧は 700KB ほどあり、 組み立てに 1 秒前後かかっていた。
//
// 「データが変わったか」は毎回 DB に軽く問い合わせて決める (巡回・写し・設定の変更・開いた記録のどれが書いても気付ける)。
// - 取得の最新 id と件数 (巡回・写し・古い履歴の削除)
// - trend_crawler.* の設定の中身 (巡回の設定・興味)
// - 開いた記録の最新 id と件数 (サイト全体 / ログインした人ごと) と、 その人の興味の更新時刻
// - 時刻の 1 時間刻み (開いた記録の 90 日の窓が少しずつずれる分)

import { createHash } from 'node:crypto';
import type BetterSqlite3 from 'better-sqlite3';

type Db = BetterSqlite3.Database;

const HOUR_MS = 60 * 60 * 1000;
/** 覚えておく数 (ログインした人ごとのマップもあるので上限を置く)。 */
const MAX_ENTRIES = 64;

/** トレンドのデータ (取得と設定) の版。 一覧はこれだけで決まる。 */
export function trendDataVersion(db: Db): string {
  const snapshots = db.prepare('SELECT COALESCE(MAX(id), 0) AS max, COUNT(*) AS n FROM trend_snapshots').get() as { max: number; n: number };
  const settings = db.prepare("SELECT key, value FROM app_settings WHERE key LIKE 'trend_crawler.%' ORDER BY key").all() as { key: string; value: string | null }[];
  const hash = createHash('sha1');
  for (const row of settings) hash.update(row.key).update('\0').update(row.value ?? '').update('\0');
  return `${snapshots.max}.${snapshots.n}.${hash.digest('hex').slice(0, 16)}`;
}

/** マップの版。 データの版に、 開いた記録 (誰の分か) と時刻の 1 時間刻みを足す。 */
export function trendMapVersion(db: Db, userId: string | null, now: number = Date.now()): string {
  const data = trendDataVersion(db);
  const hour = Math.floor(now / HOUR_MS);
  if (!userId) {
    const clicks = db.prepare('SELECT COALESCE(MAX(id), 0) AS max, COUNT(*) AS n FROM trend_clicks').get() as { max: number; n: number };
    return `${data}|site.${clicks.max}.${clicks.n}|${hour}`;
  }
  const clicks = db.prepare('SELECT COALESCE(MAX(id), 0) AS max, COUNT(*) AS n FROM user_clicks WHERE user_id = ?').get(userId) as { max: number; n: number };
  const prefs = db.prepare('SELECT updated_at FROM user_interest WHERE user_id = ?').get(userId) as { updated_at: string } | undefined;
  return `${data}|user.${clicks.max}.${clicks.n}.${prefs?.updated_at ?? '-'}|${hour}`;
}

/** 版が同じなら前に作った文字列を返す。 古い版は同じ名前の新しい版で置き換わる。 */
export class ResponseCache {
  private readonly entries = new Map<string, { version: string; body: string }>();
  private readonly max: number;

  constructor(max = MAX_ENTRIES) {
    this.max = max;
  }

  get(name: string, version: string, build: () => string): string {
    const hit = this.entries.get(name);
    if (hit && hit.version === version) {
      // 最近使ったものを後ろへ (古いものから捨てる)。
      this.entries.delete(name);
      this.entries.set(name, hit);
      return hit.body;
    }
    const body = build();
    this.entries.delete(name);
    this.entries.set(name, { version, body });
    while (this.entries.size > this.max) this.entries.delete(this.entries.keys().next().value as string);
    return body;
  }

  get size(): number {
    return this.entries.size;
  }
}
