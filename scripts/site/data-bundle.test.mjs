import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { ensureSchema } from '../../src/runtime/db.ts';
import { readVerifiedBundle, writeBundleFile } from './bundle-file.mjs';
import { assertBundle, hasExistingData, makeBundle, parseArguments, readBundleData, SCHEMA_SQL, writeBundleData } from './data-bundle.mjs';

const scriptsDir = fileURLToPath(new URL('./', import.meta.url));

function tempDir() {
  return mkdtempSync(join(tmpdir(), 'tendentia-bundle-'));
}

function schemaOf(db) {
  return db.prepare("SELECT type, name, sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type, name").all()
    .map((row) => ({ ...row, sql: row.sql.replace(/\s+/g, ' ').trim() }));
}

function seed(db) {
  db.prepare('INSERT INTO app_settings (key, value) VALUES (?, ?)').run('trend_crawler.interest', '{"genreWeights":{"tech":2},"keywords":["AI"]}');
  db.prepare('INSERT INTO app_settings (key, value) VALUES (?, ?)').run('other.setting', 'x');
  db.prepare('INSERT INTO trend_snapshots (id, source_id, genre, fetched_at, ok, error) VALUES (?, ?, ?, ?, ?, ?)').run(7, 'hn', 'tech', '2026-10-14T00:00:00.000Z', 1, null);
  db.prepare('INSERT INTO trend_snapshots (id, source_id, genre, fetched_at, ok, error) VALUES (?, ?, ?, ?, ?, ?)').run(8, 'gn', 'youth', '2026-10-14T00:00:00.000Z', 0, 'HTTP 429');
  db.prepare('INSERT INTO trend_items (snapshot_id, rank, title, subtitle, url, metric, item_key) VALUES (?, ?, ?, ?, ?, ?, ?)').run(7, 1, 'Gemini 4', null, 'https://example.com', '10 points', 'gemini4');
  db.prepare('INSERT INTO trend_clicks (item_key, genre, source_id, clicked_at) VALUES (?, ?, ?, ?)').run('gemini4', 'tech', 'hn', '2026-10-14T01:00:00.000Z');
  db.prepare('INSERT INTO user_interest (user_id, value, updated_at) VALUES (?, ?, ?)').run('u1', '{"genreWeights":{"music":3},"keywords":[]}', '2026-10-14T02:00:00.000Z');
  db.prepare('INSERT INTO user_clicks (user_id, item_key, title, genre, source_id, clicked_at) VALUES (?, ?, ?, ?, ?, ?)').run('u1', 'gemini4', 'Gemini 4', 'tech', 'hn', '2026-10-14T03:00:00.000Z');
}

test('版 1 (人ごとの記録が無い) の移行ファイルも受け付ける', () => {
  const v1 = { ...makeBundle({ settings: [], snapshots: [], items: [], clicks: [] }), version: 1 };
  assertBundle(v1);
  assert.throws(() => assertBundle({ ...v1, version: 2 }), /unexpected data sections/);
  const target = new Database(':memory:');
  target.exec(SCHEMA_SQL);
  writeBundleData(target, v1.data);
  assert.equal(hasExistingData(target), false);
});

test('移行形式の表定義はアプリが作る表と同じ', () => {
  const fromApp = new Database(':memory:');
  ensureSchema(fromApp);
  const fromScript = new Database(':memory:');
  fromScript.exec(SCHEMA_SQL);
  assert.deepEqual(schemaOf(fromScript), schemaOf(fromApp));
});

test('書き出して検証して読み込むと同じデータになり、 trend_crawler.* 以外の設定は運ばない', async () => {
  const dir = tempDir();
  try {
    const source = new Database(':memory:');
    ensureSchema(source);
    seed(source);
    const output = join(dir, 'bundle.json');
    const sha = await writeBundleFile(output, makeBundle(readBundleData(source)));
    await assert.rejects(writeBundleFile(output, makeBundle(readBundleData(source))), /EEXIST/);
    const bundle = await readVerifiedBundle(output, sha);
    assert.deepEqual(bundle.data.settings.map((row) => row.key), ['trend_crawler.interest']);

    const target = new Database(':memory:');
    target.exec(SCHEMA_SQL);
    assert.equal(hasExistingData(target), false);
    writeBundleData(target, bundle.data);
    assert.equal(hasExistingData(target), true);
    assert.deepEqual(readBundleData(target), bundle.data);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('sha256 が違う移行ファイルは読まない', async () => {
  const dir = tempDir();
  try {
    const output = join(dir, 'bundle.json');
    await writeBundleFile(output, makeBundle({ settings: [], snapshots: [], items: [], clicks: [], userInterests: [], userClicks: [] }));
    await assert.rejects(readVerifiedBundle(output, '0'.repeat(64)), /sha256 mismatch/);
    await assert.rejects(readVerifiedBundle(output, 'xyz'), /64 hex/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('他サービス・余分な項目・存在しない取得を指す行は受け付けない', () => {
  const ok = makeBundle({ settings: [], snapshots: [{ id: 1, source_id: 's', genre: 'tech', fetched_at: 't', ok: 1, error: null }], items: [], clicks: [], userInterests: [], userClicks: [] });
  assertBundle(ok);
  assert.throws(() => assertBundle({ ...ok, service: 'memoria' }), /belongs to 'memoria'/);
  assert.throws(() => assertBundle({ ...ok, extra: 1 }), /unexpected fields/);
  assert.throws(() => assertBundle({ ...ok, data: { ...ok.data, items: [{ snapshot_id: 99, rank: 1, title: 'x', subtitle: null, url: null, metric: null, item_key: 'x' }] } }), /items\[0\]/);
  assert.throws(() => assertBundle({ ...ok, data: { ...ok.data, settings: [{ key: 'secret.token', value: 'x' }] } }), /settings\[0\]/);
});

test('引数は決めた名前を 1 回ずつ、 パスは絶対パスだけ', () => {
  assert.throws(() => parseArguments(['--output', 'relative.json'], ['--output']), /absolute/);
  assert.throws(() => parseArguments(['--output', '/a', '--output', '/b'], ['--output']), /expected arguments/);
});

function runScript(name, args, dataDir) {
  return spawnSync(process.execPath, [join(scriptsDir, name), ...args], {
    encoding: 'utf8', env: { ...process.env, TENDENTIA_DATA_DIR: dataDir }, windowsHide: true,
  });
}

test('export / import スクリプト: 既存データへは取り込まず、 失敗した取り込みは新しく作った DB を残さない', () => {
  const dir = tempDir();
  try {
    const sourceDir = join(dir, 'source');
    const source = (() => { const db = new Database(join(dir, 'seed.db')); ensureSchema(db); seed(db); return db; })();
    source.close();
    // source の data dir に DB を置く。
    mkdirSync(sourceDir);
    copyFileSync(join(dir, 'seed.db'), join(sourceDir, 'tendentia.db'));

    const output = join(dir, 'out.bundle');
    const exported = runScript('export-data.mjs', ['--output', output], sourceDir);
    assert.equal(exported.status, 0, exported.stderr);
    const sha = createHash('sha256').update(readFileSync(output)).digest('hex');

    const targetDir = join(dir, 'target');
    const imported = runScript('import-data.mjs', ['--input', output, '--sha256', sha], targetDir);
    assert.equal(imported.status, 0, imported.stderr);
    const target = new Database(join(targetDir, 'tendentia.db'), { readonly: true });
    assert.equal(target.prepare('SELECT COUNT(*) AS n FROM trend_items').get().n, 1);
    target.close();

    const again = runScript('import-data.mjs', ['--input', output, '--sha256', sha], targetDir);
    assert.equal(again.status, 1);
    assert.match(again.stderr, /already has trend data/);

    const badDir = join(dir, 'bad');
    writeFileSync(join(dir, 'bad.bundle'), '{"service":"memoria"}');
    const badSha = createHash('sha256').update('{"service":"memoria"}').digest('hex');
    const failed = runScript('import-data.mjs', ['--input', join(dir, 'bad.bundle'), '--sha256', badSha], badDir);
    assert.equal(failed.status, 1);
    assert.equal(existsSync(join(badDir, 'tendentia.db')), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

