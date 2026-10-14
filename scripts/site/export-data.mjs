// Excubitor data-export: node scripts/site/export-data.mjs --output <絶対パス>
// 停止済みの Tendentia のデータを 1 つの移行ファイルに書く。 出力が既にあれば失敗する。
// DB がまだ無い (一度も起動していない) ときは、 空の各表を明示した移行ファイルを書く。

import { existsSync } from 'node:fs';
import Database from 'better-sqlite3';
import { dbPath, writeBundleFile } from './bundle-file.mjs';
import { makeBundle, parseArguments, readBundleData } from './data-bundle.mjs';

try {
  const args = parseArguments(process.argv.slice(2), ['--output']);
  const path = dbPath();
  let data = { settings: [], snapshots: [], items: [], clicks: [] };
  if (existsSync(path)) {
    const db = new Database(path, { readonly: true, fileMustExist: true });
    try { data = readBundleData(db); } finally { db.close(); }
  }
  const sha256 = await writeBundleFile(args['--output'], makeBundle(data));
  process.stdout.write(`tendentia data export: ${data.snapshots.length} snapshots, ${data.items.length} items, ${data.clicks.length} clicks, ${data.settings.length} settings (sha256 ${sha256})\n`);
} catch (error) {
  process.stderr.write(`tendentia data export failed: ${error.message}\n`);
  process.exitCode = 1;
}
