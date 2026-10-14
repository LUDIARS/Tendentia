// Cernere でログインした人ごとの好み: 興味の設定 (user_interest) と開いた記録 (user_clicks) の読み書きと、 本人の傾向の集計。
// 興味が未設定の人には本社の既定 (app_settings の trend_crawler.interest = 写し) を返す。 spec/feature/personal-login.md。

import type BetterSqlite3 from 'better-sqlite3';
import type { ClickStats, TrendInterestPrefs } from './interest.ts';
import { CLICK_WINDOW_DAYS, getInterestPrefs, interestPrefsSchema } from './interest-store.ts';
import { GENRE_LABELS, type TrendGenre } from './types.ts';

type Db = BetterSqlite3.Database;

const DAY_MS = 24 * 60 * 60 * 1000;
const WEEKS = 8;
const WEEKLY_GENRES = 5;
const TOP_TOPICS = 10;

export interface UserClickInput {
  key: string;
  genre: TrendGenre;
  sourceId: string;
  title?: string | null;
}

export interface UserTendency {
  /** 直近 90 日に開いた回数。 */
  total: number;
  genres: { genre: TrendGenre; label: string; count: number; share: number }[];
  /** 週ごと (古い順、 月曜始まり)。 counts は多いジャンル 5 つ。 */
  weekly: { weekStart: string; total: number; counts: Partial<Record<TrendGenre, number>> }[];
  topics: { title: string; genre: TrendGenre; count: number }[];
  prefs: TrendInterestPrefs;
}

export function getUserPrefs(db: Db, userId: string): TrendInterestPrefs {
  const row = db.prepare('SELECT value FROM user_interest WHERE user_id = ?').get(userId) as { value: string } | undefined;
  if (!row) return getInterestPrefs(db);
  try {
    const parsed = interestPrefsSchema.safeParse(JSON.parse(row.value));
    return parsed.success ? parsed.data as TrendInterestPrefs : getInterestPrefs(db);
  } catch {
    return getInterestPrefs(db);
  }
}

export function setUserPrefs(db: Db, userId: string, prefs: TrendInterestPrefs, at: Date = new Date()): TrendInterestPrefs {
  const next: TrendInterestPrefs = { genreWeights: prefs.genreWeights, keywords: [...new Set(prefs.keywords)] };
  db.prepare(`
    INSERT INTO user_interest (user_id, value, updated_at) VALUES (?, ?, ?)
    ON CONFLICT(user_id) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
  `).run(userId, JSON.stringify(next), at.toISOString());
  return next;
}

export function recordUserClick(db: Db, userId: string, input: UserClickInput, at: Date = new Date()): void {
  db.prepare('INSERT INTO user_clicks (user_id, item_key, title, genre, source_id, clicked_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run(userId, input.key, input.title?.slice(0, 1_000) ?? null, input.genre, input.sourceId, at.toISOString());
}

function since(now: Date): string {
  return new Date(now.getTime() - CLICK_WINDOW_DAYS * DAY_MS).toISOString();
}

/** その人だけの開いた記録 (マップの学習に使う)。 */
export function userClickStats(db: Db, userId: string, now: Date = new Date()): ClickStats {
  const from = since(now);
  const byGenre = db.prepare('SELECT genre, COUNT(*) AS n FROM user_clicks WHERE user_id = ? AND clicked_at >= ? GROUP BY genre')
    .all(userId, from) as { genre: TrendGenre; n: number }[];
  const byKey = db.prepare('SELECT item_key, COUNT(*) AS n FROM user_clicks WHERE user_id = ? AND clicked_at >= ? GROUP BY item_key')
    .all(userId, from) as { item_key: string; n: number }[];
  return {
    total: byGenre.reduce((sum, row) => sum + row.n, 0),
    byGenre: new Map(byGenre.map((row) => [row.genre, row.n])),
    byKey: new Map(byKey.map((row) => [row.item_key, row.n])),
  };
}

/** その日を含む週の月曜 (UTC) の日付。 */
export function weekStartOf(iso: string): string {
  const date = new Date(iso);
  const day = (date.getUTCDay() + 6) % 7;
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() - day)).toISOString().slice(0, 10);
}

export function userTendency(db: Db, userId: string, now: Date = new Date()): UserTendency {
  const rows = db.prepare('SELECT item_key, title, genre, clicked_at FROM user_clicks WHERE user_id = ? AND clicked_at >= ? ORDER BY clicked_at')
    .all(userId, since(now)) as { item_key: string; title: string | null; genre: TrendGenre; clicked_at: string }[];

  const genreCounts = new Map<TrendGenre, number>();
  for (const row of rows) genreCounts.set(row.genre, (genreCounts.get(row.genre) ?? 0) + 1);
  const genres = [...genreCounts].sort((a, b) => b[1] - a[1])
    .map(([genre, count]) => ({ genre, label: GENRE_LABELS[genre] ?? genre, count, share: count / rows.length }));
  const topGenres = new Set(genres.slice(0, WEEKLY_GENRES).map((entry) => entry.genre));

  const firstWeek = weekStartOf(new Date(now.getTime() - (WEEKS - 1) * 7 * DAY_MS).toISOString());
  const weeks = new Map<string, { weekStart: string; total: number; counts: Partial<Record<TrendGenre, number>> }>();
  for (let index = 0; index < WEEKS; index += 1) {
    const weekStart = new Date(Date.parse(firstWeek) + index * 7 * DAY_MS).toISOString().slice(0, 10);
    weeks.set(weekStart, { weekStart, total: 0, counts: {} });
  }
  for (const row of rows) {
    const week = weeks.get(weekStartOf(row.clicked_at));
    if (!week) continue;
    week.total += 1;
    if (topGenres.has(row.genre)) week.counts[row.genre] = (week.counts[row.genre] ?? 0) + 1;
  }

  const topics = new Map<string, { title: string; genre: TrendGenre; count: number }>();
  for (const row of rows) {
    if (!row.title) continue;
    const topic = topics.get(row.item_key) ?? { title: row.title, genre: row.genre, count: 0 };
    topic.count += 1;
    topic.title = row.title;
    topics.set(row.item_key, topic);
  }

  return {
    total: rows.length,
    genres,
    weekly: [...weeks.values()],
    topics: [...topics.values()].sort((a, b) => b.count - a.count).slice(0, TOP_TOPICS),
    prefs: getUserPrefs(db, userId),
  };
}

export function pruneUserClicksBefore(db: Db, cutoffIso: string): number {
  return db.prepare('DELETE FROM user_clicks WHERE clicked_at < ?').run(cutoffIso).changes;
}
