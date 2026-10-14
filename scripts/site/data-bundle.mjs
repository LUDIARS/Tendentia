// Tendentia のデータ移行形式 (1 つの JSON ファイル)。 export / import / Memoria からの移行で共有する。
//
// 形式: { service, format, version, persistentData: true, exportedAt, data: { settings, snapshots, items, clicks, userInterests, userClicks } }
// - settings: app_settings のうち trend_crawler.* の行 (設定・興味・最新の AI 要約)
// - snapshots / items: 巡回の履歴 (id を保ったまま移す。 items は snapshot_id で参照)
// - clicks: トレンドマップで開いた記録
// - userInterests / userClicks: Cernere でログインした人ごとの興味と開いた記録 (版 2 から。 版 1 は空として読む)
// 稼働中 DB の生ファイルは写さない。 行を読み出して JSON にする。

import { isAbsolute } from 'node:path';

export const SERVICE_ID = 'tendentia';
export const FORMAT = 'tendentia-data';
export const FORMAT_VERSION = 2;
/** 読み込みを受け付ける版。 版 1 には人ごとの記録が無い。 */
const READABLE_VERSIONS = [1, 2];
/** 30 日分の履歴でも数十 MB。 これを超えるものは受け付けない。 */
export const MAX_BUNDLE_BYTES = 512 * 1024 * 1024;
export const SETTINGS_PREFIX = 'trend_crawler.';

/** src/runtime/db.ts と src/trend/schema.ts が作る表と同じもの。 import は TypeScript を読まずに動く必要があるので、 ここにも持つ (一致はテストで確かめる)。 */
export const SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS app_settings (
    key   TEXT PRIMARY KEY,
    value TEXT
  );
  CREATE TABLE IF NOT EXISTS trend_snapshots (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    source_id  TEXT NOT NULL,
    genre      TEXT NOT NULL,
    fetched_at TEXT NOT NULL,
    ok         INTEGER NOT NULL,
    error      TEXT
  );
  CREATE TABLE IF NOT EXISTS trend_items (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    snapshot_id INTEGER NOT NULL REFERENCES trend_snapshots(id) ON DELETE CASCADE,
    rank        INTEGER NOT NULL,
    title       TEXT NOT NULL,
    subtitle    TEXT,
    url         TEXT,
    metric      TEXT,
    item_key    TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS trend_clicks (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    item_key   TEXT NOT NULL,
    genre      TEXT NOT NULL,
    source_id  TEXT NOT NULL,
    clicked_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS user_interest (
    user_id    TEXT PRIMARY KEY,
    value      TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS user_clicks (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id    TEXT NOT NULL,
    item_key   TEXT NOT NULL,
    title      TEXT,
    genre      TEXT NOT NULL,
    source_id  TEXT NOT NULL,
    clicked_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_trend_clicks_at ON trend_clicks(clicked_at);
  CREATE INDEX IF NOT EXISTS idx_user_clicks_user ON user_clicks(user_id, clicked_at);
  CREATE INDEX IF NOT EXISTS idx_user_clicks_at ON user_clicks(clicked_at);
  CREATE INDEX IF NOT EXISTS idx_trend_snapshots_source ON trend_snapshots(source_id, fetched_at);
  CREATE INDEX IF NOT EXISTS idx_trend_items_snapshot ON trend_items(snapshot_id);
  CREATE INDEX IF NOT EXISTS idx_trend_items_key ON trend_items(item_key);
`;

/** `--name value` の組を、 指定した名前それぞれ 1 回ずつだけ受け付ける。 パスは絶対パスのみ。 */
export function parseArguments(argv, names) {
  if (argv.length !== names.length * 2) throw new Error(`expected arguments: ${names.join(' ')}`);
  const result = {};
  for (let index = 0; index < argv.length; index += 2) {
    const name = argv[index];
    const value = argv[index + 1];
    if (!names.includes(name) || result[name] !== undefined || !value) throw new Error(`expected arguments: ${names.join(' ')}`);
    result[name] = value;
  }
  for (const key of ['--input', '--output', '--memoria-db']) {
    if (result[key] !== undefined && !isAbsolute(result[key])) throw new Error(`${key} must be an absolute path`);
  }
  return result;
}

/** 読み出した行から移行ファイルの中身を組む。 表が無いもの (未作成の DB) は空にする。 */
export function readBundleData(db) {
  const has = (table) => db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(table) !== undefined;
  return {
    settings: has('app_settings')
      ? db.prepare('SELECT key, value FROM app_settings WHERE key LIKE ? ORDER BY key').all(`${SETTINGS_PREFIX}%`)
      : [],
    snapshots: has('trend_snapshots')
      ? db.prepare('SELECT id, source_id, genre, fetched_at, ok, error FROM trend_snapshots ORDER BY id').all()
      : [],
    items: has('trend_items')
      ? db.prepare('SELECT snapshot_id, rank, title, subtitle, url, metric, item_key FROM trend_items ORDER BY id').all()
      : [],
    clicks: has('trend_clicks')
      ? db.prepare('SELECT item_key, genre, source_id, clicked_at FROM trend_clicks ORDER BY id').all()
      : [],
    userInterests: has('user_interest')
      ? db.prepare('SELECT user_id, value, updated_at FROM user_interest ORDER BY user_id').all()
      : [],
    userClicks: has('user_clicks')
      ? db.prepare('SELECT user_id, item_key, title, genre, source_id, clicked_at FROM user_clicks ORDER BY id').all()
      : [],
  };
}

export function makeBundle(data, exportedAt = new Date()) {
  return { service: SERVICE_ID, format: FORMAT, version: FORMAT_VERSION, persistentData: true, exportedAt: exportedAt.toISOString(), data };
}

const isObject = (value) => typeof value === 'object' && value !== null && !Array.isArray(value);
const isText = (value, max) => typeof value === 'string' && value.length <= max;
const isNullableText = (value, max) => value === null || isText(value, max);

function assertRows(rows, name, check) {
  if (!Array.isArray(rows)) throw new Error(`data.${name} must be an array`);
  rows.forEach((row, index) => {
    if (!isObject(row) || !check(row)) throw new Error(`data.${name}[${index}] is invalid`);
  });
}

/** 所有サービス・形式・版と、 各行の形を確かめる。 余分な項目は受け付けない。 */
export function assertBundle(value) {
  if (!isObject(value)) throw new Error('data bundle is not a JSON object');
  if (value.service !== SERVICE_ID) throw new Error(`data bundle belongs to '${String(value.service)}', not ${SERVICE_ID}`);
  if (value.format !== FORMAT || !READABLE_VERSIONS.includes(value.version)) throw new Error('unsupported data bundle format or version');
  if (value.persistentData !== true || !isText(value.exportedAt, 64) || !isObject(value.data)) throw new Error('data bundle header is invalid');
  if (Object.keys(value).sort().join(',') !== 'data,exportedAt,format,persistentData,service,version') throw new Error('data bundle has unexpected fields');
  const { data } = value;
  const sections = value.version === 1 ? 'clicks,items,settings,snapshots' : 'clicks,items,settings,snapshots,userClicks,userInterests';
  if (Object.keys(data).sort().join(',') !== sections) throw new Error('data bundle has unexpected data sections');
  assertRows(data.settings, 'settings', (row) => isText(row.key, 200) && row.key.startsWith(SETTINGS_PREFIX) && isNullableText(row.value, 10_000_000));
  assertRows(data.snapshots, 'snapshots', (row) => Number.isInteger(row.id) && row.id > 0 && isText(row.source_id, 80)
    && isText(row.genre, 40) && isText(row.fetched_at, 64) && (row.ok === 0 || row.ok === 1) && isNullableText(row.error, 2_000));
  const snapshotIds = new Set(data.snapshots.map((row) => row.id));
  if (snapshotIds.size !== data.snapshots.length) throw new Error('data.snapshots has duplicate ids');
  assertRows(data.items, 'items', (row) => snapshotIds.has(row.snapshot_id) && Number.isInteger(row.rank) && isText(row.title, 1_000)
    && isNullableText(row.subtitle, 1_000) && isNullableText(row.url, 4_000) && isNullableText(row.metric, 200) && isText(row.item_key, 400));
  assertRows(data.clicks, 'clicks', (row) => isText(row.item_key, 400) && isText(row.genre, 40) && isText(row.source_id, 80) && isText(row.clicked_at, 64));
  if (value.version === 1) return;
  assertRows(data.userInterests, 'userInterests', (row) => isText(row.user_id, 200) && row.user_id.length > 0 && isText(row.value, 1_000_000) && isText(row.updated_at, 64));
  if (new Set(data.userInterests.map((row) => row.user_id)).size !== data.userInterests.length) throw new Error('data.userInterests has duplicate users');
  assertRows(data.userClicks, 'userClicks', (row) => isText(row.user_id, 200) && row.user_id.length > 0 && isText(row.item_key, 400)
    && isNullableText(row.title, 1_000) && isText(row.genre, 40) && isText(row.source_id, 80) && isText(row.clicked_at, 64));
}

/** 受け入れ先にトレンドのデータが既にあるか (あれば import を断る)。 */
export function hasExistingData(db) {
  const count = (sql, ...args) => db.prepare(sql).get(...args).n;
  return count('SELECT COUNT(*) AS n FROM trend_snapshots') > 0
    || count('SELECT COUNT(*) AS n FROM trend_clicks') > 0
    || count('SELECT COUNT(*) AS n FROM user_clicks') > 0
    || count('SELECT COUNT(*) AS n FROM user_interest') > 0
    || count('SELECT COUNT(*) AS n FROM app_settings WHERE key LIKE ?', `${SETTINGS_PREFIX}%`) > 0;
}

/** 1 つのトランザクションで書き込む。 途中で失敗したら何も残らない。 */
export function writeBundleData(db, data) {
  const insertSetting = db.prepare('INSERT INTO app_settings (key, value) VALUES (?, ?)');
  const insertSnapshot = db.prepare('INSERT INTO trend_snapshots (id, source_id, genre, fetched_at, ok, error) VALUES (?, ?, ?, ?, ?, ?)');
  const insertItem = db.prepare('INSERT INTO trend_items (snapshot_id, rank, title, subtitle, url, metric, item_key) VALUES (?, ?, ?, ?, ?, ?, ?)');
  const insertClick = db.prepare('INSERT INTO trend_clicks (item_key, genre, source_id, clicked_at) VALUES (?, ?, ?, ?)');
  const insertUserInterest = db.prepare('INSERT INTO user_interest (user_id, value, updated_at) VALUES (?, ?, ?)');
  const insertUserClick = db.prepare('INSERT INTO user_clicks (user_id, item_key, title, genre, source_id, clicked_at) VALUES (?, ?, ?, ?, ?, ?)');
  db.transaction(() => {
    for (const row of data.settings) insertSetting.run(row.key, row.value);
    for (const row of data.snapshots) insertSnapshot.run(row.id, row.source_id, row.genre, row.fetched_at, row.ok, row.error);
    for (const row of data.items) insertItem.run(row.snapshot_id, row.rank, row.title, row.subtitle, row.url, row.metric, row.item_key);
    for (const row of data.clicks) insertClick.run(row.item_key, row.genre, row.source_id, row.clicked_at);
    for (const row of data.userInterests ?? []) insertUserInterest.run(row.user_id, row.value, row.updated_at);
    for (const row of data.userClicks ?? []) insertUserClick.run(row.user_id, row.item_key, row.title, row.genre, row.source_id, row.clicked_at);
  })();
}
