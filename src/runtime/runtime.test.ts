import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import Database from 'better-sqlite3';
import { AccessGate } from './access-gate.js';
import { makeApp } from './app.js';
import { readRuntimeConfig } from './config.js';
import { ensureSchema } from './db.js';
import { staticEntry } from './static.js';

test('設定はポートが必須で、 データの置き場所はリポジトリ直下からの相対も受ける', () => {
  assert.throws(() => readRuntimeConfig({}, '/repo'), /TENDENTIA_PORT/);
  assert.throws(() => readRuntimeConfig({ TENDENTIA_PORT: 'abc' }, '/repo'), /TENDENTIA_PORT/);
  const config = readRuntimeConfig({ TENDENTIA_PORT: '4450' }, '/repo');
  assert.equal(config.port, 4450);
  assert.equal(config.host, '127.0.0.1');
  assert.match(config.dataDir.replace(/\\/g, '/'), /\/repo\/data$/);
  assert.match(config.webDir.replace(/\\/g, '/'), /\/repo\/dist\/web$/);
});

test('画面の配信は決まったファイルだけを返し、 API のパスは扱わない', () => {
  assert.equal(staticEntry('/')?.file, 'index.html');
  assert.equal(staticEntry('/app.js')?.file, 'app.js');
  assert.equal(staticEntry('/../package.json')?.file, 'index.html');
  assert.equal(staticEntry('/api/trend-crawler/nope'), null);
});

test('health と画面を返す', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'tendentia-web-'));
  try {
    mkdirSync(join(dir, 'web'));
    writeFileSync(join(dir, 'web', 'index.html'), '<!doctype html><title>Tendentia</title>');
    const db = new Database(':memory:');
    ensureSchema(db);
    const local = new AccessGate({ entrance: { origin: null, hosts: [] }, sameMachine: () => true });
    const app = makeApp({ db, webDir: join(dir, 'web'), version: '0.1.0', gate: local });
    const health = await app.request('http://127.0.0.1/health');
    assert.deepEqual(await health.json(), { ok: true, service: 'tendentia', version: '0.1.0' });
    const page = await app.request('http://127.0.0.1/');
    assert.equal(page.status, 200);
    assert.match(await page.text(), /Tendentia/);
    const missing = makeApp({ db, webDir: join(dir, 'none'), version: '0.1.0', gate: local });
    assert.equal((await missing.request('http://127.0.0.1/style.css')).status, 503);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
