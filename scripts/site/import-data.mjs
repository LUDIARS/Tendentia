// Excubitor data-import: node scripts/site/import-data.mjs --input <絶対パス> --sha256 <64 桁の 16 進>
// sha256・所有サービス・形式版を確かめてから、 停止中の Tendentia の DB に 1 トランザクションで書き込む。
// 受け入れ先にトレンドのデータが既にあれば断る (上書きしない)。 途中で失敗したら書き込みは残らず、
// この import で新しく作った DB ファイルは消す (元から DB があった場合はそのまま残る)。

import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { dirname } from 'node:path';
import Database from 'better-sqlite3';
import { dbPath, readVerifiedBundle } from './bundle-file.mjs';
import { hasExistingData, parseArguments, SCHEMA_SQL, writeBundleData } from './data-bundle.mjs';

const path = dbPath();
const created = !existsSync(path);
let db = null;
try {
  const args = parseArguments(process.argv.slice(2), ['--input', '--sha256']);
  const bundle = await readVerifiedBundle(args['--input'], args['--sha256']);
  mkdirSync(dirname(path), { recursive: true });
  db = new Database(path);
  db.exec(SCHEMA_SQL);
  if (hasExistingData(db)) throw new Error('Tendentia already has trend data; import refuses to overwrite it');
  writeBundleData(db, bundle.data);
  const { snapshots, items, clicks, settings } = bundle.data;
  process.stdout.write(`tendentia data import: ${snapshots.length} snapshots, ${items.length} items, ${clicks.length} clicks, ${settings.length} settings\n`);
} catch (error) {
  process.stderr.write(`tendentia data import failed: ${error.message}\n`);
  process.exitCode = 1;
} finally {
  if (db) db.close();
  if (process.exitCode === 1 && created) {
    for (const suffix of ['', '-wal', '-shm']) rmSync(`${path}${suffix}`, { force: true });
  }
}
