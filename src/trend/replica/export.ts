// collector 側: 指定位置より後の取得 (snapshot) とその項目、 設定を書き出す。 DB を読むだけ。 開いた記録は出さない。
// 1 回の巡回は全ソースが同じ時刻になるので、 時刻ではなく id を位置に使う (途中で切っても取りこぼさない)。

import type BetterSqlite3 from 'better-sqlite3';
import type { SyncCursor, SyncExport, SyncItem, SyncSetting, SyncSnapshot } from './types.ts';

type Db = BetterSqlite3.Database;

export const EXPORT_SNAPSHOT_LIMIT = 200;
/** 写す設定。 巡回の設定 (表示するソース・ジャンル) と興味の設定。 */
export const SYNC_SETTING_KEYS = ['trend_crawler.config', 'trend_crawler.interest'];

export function exportSince(db: Db, after: SyncCursor, limit = EXPORT_SNAPSHOT_LIMIT): SyncExport {
  const snapshots = db.prepare(
    'SELECT id, source_id, genre, fetched_at, ok, error FROM trend_snapshots WHERE id > ? ORDER BY id LIMIT ?',
  ).all(after.snapshot, limit + 1) as SyncSnapshot[];
  const more = snapshots.length > limit;
  if (more) snapshots.length = limit;

  const itemsOf = db.prepare(
    'SELECT snapshot_id, rank, title, subtitle, url, metric, item_key FROM trend_items WHERE snapshot_id = ? ORDER BY rank',
  );
  const items = snapshots.flatMap((snapshot) => itemsOf.all(snapshot.id) as SyncItem[]);

  const settings = SYNC_SETTING_KEYS.map((key) => {
    const row = db.prepare('SELECT value FROM app_settings WHERE key = ?').get(key) as { value: string | null } | undefined;
    return { key, value: row?.value ?? null } satisfies SyncSetting;
  });

  return {
    version: 1,
    snapshots,
    items,
    settings,
    cursor: { snapshot: snapshots.at(-1)?.id ?? after.snapshot },
    more,
  };
}
