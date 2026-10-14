// viewer 側: collector の書き出しを確かめてから自分の DB へ入れる。 1 回分を 1 トランザクションで入れる。
// 取得は id を保ったまま入れ、 既にある id は飛ばす (同じ書き出しを 2 回入れても増えない)。
// 設定は丸ごと置き換える (値が null なら消す = collector 側で既定に戻した)。

import type BetterSqlite3 from 'better-sqlite3';
import { SYNC_SETTING_KEYS } from './export.ts';
import type { SyncExport } from './types.ts';

type Db = BetterSqlite3.Database;

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const isInt = (v: unknown): v is number => Number.isInteger(v) && (v as number) >= 0;
const isText = (v: unknown, max: number): v is string => typeof v === 'string' && v.length <= max;
const isNullableText = (v: unknown, max: number): boolean => v === null || isText(v, max);

function rows(value: unknown, name: string, check: (row: Obj) => boolean): Obj[] {
  if (!Array.isArray(value)) throw new Error(`${name} が配列ではありません`);
  value.forEach((row, index) => {
    if (!isObj(row) || !check(row)) throw new Error(`${name}[${index}] の形が不正です`);
  });
  return value as Obj[];
}

/** 外部 (collector) からの応答なので、 形と長さを確かめてから型を付ける。 */
export function parseSyncExport(value: unknown): SyncExport {
  if (!isObj(value) || value.version !== 1) throw new Error('複製の書き出しの形式が違います');
  const snapshots = rows(value.snapshots, 'snapshots', (r) => isInt(r.id) && (r.id as number) > 0 && isText(r.source_id, 80)
    && isText(r.genre, 40) && isText(r.fetched_at, 64) && (r.ok === 0 || r.ok === 1) && isNullableText(r.error, 2_000));
  const ids = new Set(snapshots.map((r) => r.id as number));
  rows(value.items, 'items', (r) => ids.has(r.snapshot_id as number) && isInt(r.rank) && isText(r.title, 1_000)
    && isNullableText(r.subtitle, 1_000) && isNullableText(r.url, 4_000) && isNullableText(r.metric, 200) && isText(r.item_key, 400));
  rows(value.settings, 'settings', (r) => isText(r.key, 200) && SYNC_SETTING_KEYS.includes(r.key as string) && isNullableText(r.value, 10_000_000));
  const cursor = value.cursor;
  if (!isObj(cursor) || !isInt(cursor.snapshot)) throw new Error('cursor の形が不正です');
  if (typeof value.more !== 'boolean') throw new Error('more の形が不正です');
  return value as unknown as SyncExport;
}

export function applySyncExport(db: Db, data: SyncExport): { snapshots: number; items: number } {
  const insertSnapshot = db.prepare('INSERT OR IGNORE INTO trend_snapshots (id, source_id, genre, fetched_at, ok, error) VALUES (?, ?, ?, ?, ?, ?)');
  const insertItem = db.prepare('INSERT INTO trend_items (snapshot_id, rank, title, subtitle, url, metric, item_key) VALUES (?, ?, ?, ?, ?, ?, ?)');
  const upsertSetting = db.prepare('INSERT INTO app_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value');
  const deleteSetting = db.prepare('DELETE FROM app_settings WHERE key = ?');
  return db.transaction(() => {
    const fresh = new Set<number>();
    for (const s of data.snapshots) {
      if (insertSnapshot.run(s.id, s.source_id, s.genre, s.fetched_at, s.ok, s.error).changes > 0) fresh.add(s.id);
    }
    let items = 0;
    for (const i of data.items) {
      if (!fresh.has(i.snapshot_id)) continue; // 既に入っている取得の項目は入れ直さない
      insertItem.run(i.snapshot_id, i.rank, i.title, i.subtitle, i.url, i.metric, i.item_key);
      items += 1;
    }
    for (const setting of data.settings) {
      if (setting.value === null) deleteSetting.run(setting.key);
      else upsertSetting.run(setting.key, setting.value);
    }
    return { snapshots: fresh.size, items };
  })();
}

/** 自分が持っている最後の位置 (次に頼む位置)。 古い履歴を消しても戻らないよう、 取り込んだ位置も覚えておく。 */
const CURSOR_KEY = 'trend_replica.cursor';

export function localCursor(db: Db): { snapshot: number } {
  const max = (db.prepare('SELECT COALESCE(MAX(id), 0) AS n FROM trend_snapshots').get() as { n: number }).n;
  const row = db.prepare('SELECT value FROM app_settings WHERE key = ?').get(CURSOR_KEY) as { value: string | null } | undefined;
  const stored = Number(row?.value ?? 0);
  return { snapshot: Math.max(max, Number.isInteger(stored) && stored > 0 ? stored : 0) };
}

export function saveLocalCursor(db: Db, cursor: { snapshot: number }): void {
  db.prepare('INSERT INTO app_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
    .run(CURSOR_KEY, String(cursor.snapshot));
}
