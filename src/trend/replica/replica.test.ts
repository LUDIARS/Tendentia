import assert from 'node:assert/strict';
import { test } from 'node:test';
import Database from 'better-sqlite3';
import type { Context } from 'hono';
import { AccessGate } from '../../runtime/access-gate.ts';
import { makeApp } from '../../runtime/app.ts';
import { readRuntimeConfig } from '../../runtime/config.ts';
import { ensureSchema } from '../../runtime/db.ts';
import { recordSnapshot } from '../store.ts';
import { exportSince } from './export.ts';
import { applySyncExport, localCursor, parseSyncExport } from './import.ts';
import { exportUrl, pullFromUpstream } from './puller.ts';

function openDb(): Database.Database {
  const db = new Database(':memory:');
  ensureSchema(db);
  return db;
}

const NOW = new Date('2026-10-14T09:00:00.000Z');

function crawl(db: Database.Database, sourceId: string, titles: string[], fetchedAt = NOW.toISOString()): number {
  return recordSnapshot(db, {
    sourceId, genre: 'general', fetchedAt, ok: true, error: null,
    items: titles.map((title, index) => ({ rank: index + 1, title, subtitle: null, url: null, metric: null })),
  });
}

const count = (db: Database.Database, table: string): number => (db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n;

test('書き出し: 位置より後の取得と項目を id 順に上限まで出し、 開いた記録は出さない', () => {
  const db = openDb();
  const a = crawl(db, 'google', ['AA', 'BB']);
  const b = crawl(db, 'wiki', ['CC']);
  const c = crawl(db, 'google', ['DD']);
  db.prepare("INSERT INTO app_settings (key, value) VALUES ('trend_crawler.interest', '{\"genres\":{}}')").run();
  db.prepare("INSERT INTO app_settings (key, value) VALUES ('other.secret', 'x')").run();

  const first = exportSince(db, { snapshot: 0 }, 2);
  assert.deepEqual(first.snapshots.map((s) => s.id), [a, b]);
  assert.deepEqual(first.items.map((i) => i.title), ['AA', 'BB', 'CC']);
  assert.deepEqual(first.cursor, { snapshot: b });
  assert.equal(first.more, true);
  assert.deepEqual(first.settings, [
    { key: 'trend_crawler.config', value: null },
    { key: 'trend_crawler.interest', value: '{"genres":{}}' },
  ]);
  assert.equal(JSON.stringify(first).includes('click'), false);

  const rest = exportSince(db, first.cursor, 2);
  assert.deepEqual(rest.snapshots.map((s) => s.id), [c]);
  assert.equal(rest.more, false);
  const none = exportSince(db, rest.cursor, 2);
  assert.deepEqual(none.snapshots, []);
  assert.deepEqual(none.cursor, rest.cursor);
});

test('取り込み: 形を確かめ、 id を保って入れ、 同じものを 2 回入れても増えない。 null の設定は消す', () => {
  const source = openDb();
  crawl(source, 'google', ['AA', 'BB']);
  crawl(source, 'wiki', ['CC']);
  source.prepare("INSERT INTO app_settings (key, value) VALUES ('trend_crawler.interest', '{\"genres\":{\"ai\":3}}')").run();
  const data = parseSyncExport(JSON.parse(JSON.stringify(exportSince(source, { snapshot: 0 }))));

  const replica = openDb();
  replica.prepare("INSERT INTO app_settings (key, value) VALUES ('trend_crawler.config', 'old')").run();
  assert.deepEqual(applySyncExport(replica, data), { snapshots: 2, items: 3 });
  assert.deepEqual(applySyncExport(replica, data), { snapshots: 0, items: 0 });
  assert.equal(count(replica, 'trend_snapshots'), 2);
  assert.equal(count(replica, 'trend_items'), 3);
  assert.deepEqual(localCursor(replica), localCursor(source));
  const settings = replica.prepare('SELECT key, value FROM app_settings ORDER BY key').all();
  assert.deepEqual(settings, [{ key: 'trend_crawler.interest', value: '{"genres":{"ai":3}}' }]);
});

test('取り込み: 形の違う書き出し・写さない設定・取得に無い項目は断る', () => {
  const ok = { version: 1, snapshots: [], items: [], settings: [], cursor: { snapshot: 0 }, more: false };
  assert.doesNotThrow(() => parseSyncExport(ok));
  assert.throws(() => parseSyncExport({ ...ok, version: 2 }), /形式/);
  assert.throws(() => parseSyncExport({ ...ok, settings: [{ key: 'other.secret', value: 'x' }] }), /settings/);
  assert.throws(() => parseSyncExport({ ...ok, items: [{ snapshot_id: 9, rank: 1, title: 'A', subtitle: null, url: null, metric: null, item_key: 'a' }] }), /items/);
  assert.throws(() => parseSyncExport({ ...ok, snapshots: [{ id: -1, source_id: 's', genre: 'g', fetched_at: 't', ok: 1, error: null }] }), /snapshots/);
  assert.throws(() => parseSyncExport({ ...ok, cursor: { snapshot: 'x' } }), /cursor/);
  assert.throws(() => parseSyncExport({ ...ok, more: 'no' }), /more/);
});

test('取りに行く: 続きが無くなるまでページを辿り、 次の回は続きからだけ頼む。 保持日数より古い履歴は消す', async () => {
  const source = openDb();
  for (let i = 0; i < 5; i += 1) crawl(source, `s${i}`, [`T${i}`]);
  crawl(source, 'old', ['OLD'], '2026-08-01T00:00:00.000Z');
  const asked: string[] = [];
  const fetchJson = async (url: string): Promise<unknown> => {
    asked.push(url);
    const after = Number(new URL(url).searchParams.get('after'));
    return JSON.parse(JSON.stringify(exportSince(source, { snapshot: after }, 2)));
  };

  const replica = openDb();
  const result = await pullFromUpstream(replica, 'https://hq.example.com', NOW, fetchJson);
  assert.deepEqual(result, { pages: 3, snapshots: 6, items: 6 });
  assert.equal(asked[0], 'https://hq.example.com/api/sync/export?after=0');
  // 30 日 (既定の保持日数) より古い取得は取り込み後に消える。
  assert.equal(count(replica, 'trend_snapshots'), 5);

  crawl(source, 'new', ['NEW']);
  asked.length = 0;
  const next = await pullFromUpstream(replica, 'https://hq.example.com', NOW, fetchJson);
  assert.equal(next.snapshots, 1);
  assert.equal(asked.length, 1);
  assert.equal(exportUrl('https://hq.example.com', 7), 'https://hq.example.com/api/sync/export?after=7');
});

function fakeContext(host: string, method = 'GET'): Context {
  return { req: { method, header: (name: string) => (name.toLowerCase() === 'host' ? host : undefined) } } as unknown as Context;
}

test('viewer の入口: 同じ端末からも変更は断り、 閲覧は通して変更できないと知らせる', async () => {
  const entrance = { origin: 'https://tendentia.example.com', hosts: ['tendentia.example.com'] };
  const gate = new AccessGate({ entrance, readOnly: true, sameMachine: (c) => c.req.header('host') === '127.0.0.1:4451' });
  assert.deepEqual(await gate.decide(fakeContext('127.0.0.1:4451')), { ok: true, via: 'local', canEdit: false });
  assert.deepEqual(await gate.decide(fakeContext('tendentia.example.com')), { ok: true, via: 'public', canEdit: false });
  const write = await gate.decide(fakeContext('127.0.0.1:4451', 'POST'));
  assert.deepEqual(write, { ok: false, status: 403, reason: 'この Tendentia は閲覧専用です (変更は本社の Tendentia で)' });
  const other = await gate.decide(fakeContext('evil.com'));
  assert.equal(other.ok ? 0 : other.status, 403);
});

test('書き出し口: collector だけが出し、 公開 Host から誰でも読め、 位置の誤りは 400', async () => {
  const db = openDb();
  crawl(db, 'google', ['AA']);
  const entrance = { origin: 'https://tendentia-hq.example.com', hosts: ['tendentia-hq.example.com'] };
  const gate = new AccessGate({ entrance, sameMachine: () => false });
  const at = (app: ReturnType<typeof makeApp>, path: string) => app.request(`https://tendentia-hq.example.com${path}`, { headers: { host: 'tendentia-hq.example.com' } });

  const collector = makeApp({ db, webDir: 'Z:/no-such-dir', version: '0.1.0', gate, syncExport: true });
  const response = await at(collector, '/api/sync/export?after=0');
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  const body = await response.json() as { snapshots: unknown[] };
  assert.equal(body.snapshots.length, 1);
  assert.equal((await at(collector, '/api/sync/export?after=-1')).status, 400);

  const viewer = makeApp({ db, webDir: 'Z:/no-such-dir', version: '0.1.0', gate });
  const missing = await at(viewer, '/api/sync/export?after=0');
  assert.notEqual(missing.status, 200);
});

test('役割の設定: 既定は collector、 viewer は https の本社 URL が要る', () => {
  assert.equal(readRuntimeConfig({ TENDENTIA_PORT: '4450' }, '/repo').role, 'collector');
  assert.equal(readRuntimeConfig({ TENDENTIA_PORT: '4450' }, '/repo').upstreamUrl, null);
  const viewer = readRuntimeConfig({ TENDENTIA_PORT: '4451', TENDENTIA_ROLE: 'viewer', TENDENTIA_UPSTREAM_URL: 'https://hq.example.com/' }, '/repo');
  assert.equal(viewer.role, 'viewer');
  assert.equal(viewer.upstreamUrl, 'https://hq.example.com');
  assert.throws(() => readRuntimeConfig({ TENDENTIA_PORT: '4451', TENDENTIA_ROLE: 'viewer' }, '/repo'), /TENDENTIA_UPSTREAM_URL/);
  assert.throws(() => readRuntimeConfig({ TENDENTIA_PORT: '4451', TENDENTIA_ROLE: 'viewer', TENDENTIA_UPSTREAM_URL: 'http://hq.example.com' }, '/repo'), /https/);
  assert.throws(() => readRuntimeConfig({ TENDENTIA_PORT: '4450', TENDENTIA_ROLE: 'mirror' }, '/repo'), /TENDENTIA_ROLE/);
});
