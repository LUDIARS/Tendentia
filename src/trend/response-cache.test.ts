import assert from 'node:assert/strict';
import { test } from 'node:test';
import Database from 'better-sqlite3';
import { ensureSchema } from '../runtime/db.ts';
import { recordClick } from './interest-store.ts';
import { recordUserClick, setUserPrefs } from './personal-store.ts';
import { ResponseCache, trendDataVersion, trendMapVersion } from './response-cache.ts';
import { recordSnapshot } from './store.ts';

function openDb(): Database.Database {
  const db = new Database(':memory:');
  ensureSchema(db);
  return db;
}

const crawl = (db: Database.Database, sourceId: string): number => recordSnapshot(db, {
  sourceId, genre: 'general', fetchedAt: '2026-10-14T09:00:00.000Z', ok: true, error: null,
  items: [{ rank: 1, title: 'A', subtitle: null, url: null, metric: null }],
});

test('データの版は、 取得・削除・設定の変更で変わり、 何もしなければ変わらない', () => {
  const db = openDb();
  const v0 = trendDataVersion(db);
  assert.equal(trendDataVersion(db), v0);
  const id = crawl(db, 's1');
  const v1 = trendDataVersion(db);
  assert.notEqual(v1, v0);
  db.prepare('DELETE FROM trend_snapshots WHERE id = ?').run(id);
  crawl(db, 's2');
  db.prepare('DELETE FROM trend_snapshots WHERE source_id = ?').run('s1');
  assert.notEqual(trendDataVersion(db), v1);
  const v2 = trendDataVersion(db);
  db.prepare("INSERT INTO app_settings (key, value) VALUES ('trend_crawler.interest', '{}')").run();
  assert.notEqual(trendDataVersion(db), v2);
  const v3 = trendDataVersion(db);
  db.prepare("INSERT INTO app_settings (key, value) VALUES ('other.key', 'x')").run();
  assert.equal(trendDataVersion(db), v3);
});

test('マップの版は、 開いた記録 (サイト全体 / その人) と興味の変更、 1 時間の区切りで変わる', () => {
  const db = openDb();
  const now = Date.parse('2026-10-14T09:10:00.000Z');
  const site = trendMapVersion(db, null, now);
  const alice = trendMapVersion(db, 'alice', now);
  recordClick(db, { key: 'a', genre: 'tech', sourceId: 's' });
  assert.notEqual(trendMapVersion(db, null, now), site);
  assert.equal(trendMapVersion(db, 'alice', now), alice);
  recordUserClick(db, 'alice', { key: 'a', genre: 'tech', sourceId: 's' });
  const alice2 = trendMapVersion(db, 'alice', now);
  assert.notEqual(alice2, alice);
  setUserPrefs(db, 'alice', { genreWeights: { tech: 3 }, keywords: [] }, new Date(now));
  assert.notEqual(trendMapVersion(db, 'alice', now), alice2);
  assert.notEqual(trendMapVersion(db, null, now + 60 * 60 * 1000), trendMapVersion(db, null, now));
});

test('応答の文字列は版が同じなら組み立て直さず、 上限を超えたら古いものから捨てる', () => {
  const cache = new ResponseCache(2);
  let builds = 0;
  const build = (text: string) => () => { builds += 1; return text; };
  assert.equal(cache.get('map:', 'v1', build('A')), 'A');
  assert.equal(cache.get('map:', 'v1', build('B')), 'A');
  assert.equal(builds, 1);
  assert.equal(cache.get('map:', 'v2', build('C')), 'C');
  assert.equal(builds, 2);
  cache.get('map:alice', 'v1', build('D'));
  cache.get('map:bob', 'v1', build('E'));
  assert.equal(cache.size, 2);
  assert.equal(cache.get('map:', 'v2', build('F')), 'F');
});
