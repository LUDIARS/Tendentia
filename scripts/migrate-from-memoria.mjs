// Memoria のトレンド機能から Tendentia へ移すための移行ファイルを作る (1 回きりの移行用)。
//
//   node scripts/migrate-from-memoria.mjs --memoria-db <Memoria の memoria.db の絶対パス> --output <絶対パス>
//
// Memoria の DB は読み取り専用で開き、 trend_snapshots / trend_items / trend_clicks と
// app_settings の trend_crawler.* だけを読む (Memoria の他のデータには触れない)。
// 出力は Tendentia の通常の移行形式なので、 そのまま scripts/site/import-data.mjs で取り込む。

import Database from 'better-sqlite3';
import { writeBundleFile } from './site/bundle-file.mjs';
import { assertBundle, makeBundle, parseArguments, readBundleData } from './site/data-bundle.mjs';

try {
  const args = parseArguments(process.argv.slice(2), ['--memoria-db', '--output']);
  const db = new Database(args['--memoria-db'], { readonly: true, fileMustExist: true });
  let bundle;
  try {
    bundle = makeBundle(readBundleData(db));
  } finally {
    db.close();
  }
  assertBundle(bundle);
  const sha256 = await writeBundleFile(args['--output'], bundle);
  const { snapshots, items, clicks, settings } = bundle.data;
  process.stdout.write(`memoria → tendentia: ${snapshots.length} snapshots, ${items.length} items, ${clicks.length} clicks, ${settings.length} settings\n`);
  process.stdout.write(`sha256 ${sha256}\n`);
} catch (error) {
  process.stderr.write(`migrate-from-memoria failed: ${error.message}\n`);
  process.exitCode = 1;
}
