import assert from 'node:assert/strict';
import { test } from 'node:test';
import Database from 'better-sqlite3';
import { ensureTrendCrawlerSchema } from './schema.ts';
import { pruneUserClicksBefore, recordUserClick, userClickStats, userTendency, weekStartOf } from './personal-store.ts';

function openDb(): Database.Database {
  const db = new Database(':memory:');
  db.exec('CREATE TABLE app_settings (key TEXT PRIMARY KEY, value TEXT)');
  ensureTrendCrawlerSchema(db);
  return db;
}

const NOW = new Date('2026-10-14T09:00:00.000Z'); // 水曜

test('週の始まりは月曜 (UTC)', () => {
  assert.equal(weekStartOf('2026-10-14T09:00:00.000Z'), '2026-10-12');
  assert.equal(weekStartOf('2026-10-12T00:00:00.000Z'), '2026-10-12');
  assert.equal(weekStartOf('2026-10-11T23:59:59.000Z'), '2026-10-05');
});

test('傾向: ジャンルの割合・週ごとの回数・よく開いた話題を本人の分だけ数え、 90 日より古いものは入れない', () => {
  const db = openDb();
  const click = (user: string, genre: 'music' | 'game' | 'ai', title: string, at: string) =>
    recordUserClick(db, user, { key: title, genre, sourceId: 's', title }, new Date(at));
  click('u1', 'music', '曲A', '2026-10-13T10:00:00.000Z');
  click('u1', 'music', '曲A', '2026-10-14T08:00:00.000Z');
  click('u1', 'game', 'ゲームX', '2026-10-06T10:00:00.000Z');
  click('u1', 'ai', '古い話', '2026-06-01T00:00:00.000Z');
  click('u2', 'ai', '他人の話', '2026-10-14T08:00:00.000Z');

  const tendency = userTendency(db, 'u1', NOW);
  assert.equal(tendency.total, 3);
  assert.deepEqual(tendency.genres.map((g) => [g.genre, g.count, Math.round(g.share * 100)]), [['music', 2, 67], ['game', 1, 33]]);
  assert.equal(tendency.weekly.length, 8);
  assert.deepEqual(tendency.weekly.slice(-2), [
    { weekStart: '2026-10-05', total: 1, counts: { game: 1 } },
    { weekStart: '2026-10-12', total: 2, counts: { music: 2 } },
  ]);
  assert.deepEqual(tendency.topics.map((t) => [t.title, t.count]), [['曲A', 2], ['ゲームX', 1]]);
  assert.equal(userClickStats(db, 'u1', NOW).byGenre.get('music'), 2);
  assert.equal(userClickStats(db, 'u2', NOW).total, 1);

  assert.equal(pruneUserClicksBefore(db, '2026-07-16T00:00:00.000Z'), 1);
});
