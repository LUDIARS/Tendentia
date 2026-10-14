import assert from 'node:assert/strict';
import { test } from 'node:test';
import Database from 'better-sqlite3';
import { DEFAULT_TREND_CRAWLER_CONFIG, getTrendCrawlerConfig, setTrendCrawlerConfig, trendCrawlerConfigSchema, withNewDefaultSources } from './config.js';
import { DEFAULT_TREND_SOURCE_RELEASES, DEFAULT_TREND_SOURCES } from './default-sources.js';
import { HostPacer, interleaveByHost } from './host-pacer.js';
import { pickHighlights } from './highlights.js';
import { buildTrendOverview } from './overview.js';
import { ensureTrendCrawlerSchema } from './schema.js';
import { shouldCrawlTrends } from './scheduler.js';
import { crawlTrends } from './service.js';
import { narouOrder, narouRequestUrl, parseNarouRanking } from './sources/narou-source.js';
import { TREND_GENRES, type RawTrendItem, type TrendCrawlerConfig, type TrendSource, type TrendSourceView } from './types.js';

const SOURCES: TrendSource[] = [
  { id: 'google', name: 'Google', genre: 'general', kind: 'rss', url: 'https://trends.example/rss', enabled: true },
  { id: 'wiki', name: 'Wikipedia', genre: 'general', kind: 'wikipedia_top', url: 'https://ja.wikipedia.org', enabled: true },
  { id: 'off', name: 'Off', genre: 'tech', kind: 'rss', url: 'https://off.example/rss', enabled: false },
];

function openDb(config: Partial<TrendCrawlerConfig> = {}): Database.Database {
  const db = new Database(':memory:');
  db.exec('CREATE TABLE app_settings (key TEXT PRIMARY KEY, value TEXT)');
  ensureTrendCrawlerSchema(db);
  setTrendCrawlerConfig(db, { ...DEFAULT_TREND_CRAWLER_CONFIG, sources: SOURCES, ...config });
  return db;
}

const items = (...titles: string[]): RawTrendItem[] => titles.map((title, index) => ({ rank: index + 1, title, subtitle: null, url: null, metric: null }));

/** 待たない pacer (テストで時間を使わない)。 */
const noWaitPacer = (): HostPacer => new HostPacer(async () => {});

test('巡回は有効なソースだけ取得し、 前回との順位差・初登場・注目を出す', async () => {
  const db = openDb();
  const lists: Record<string, RawTrendItem[][]> = {
    google: [items('AA', 'BB', 'CC', 'ZZ'), items('CC', 'AA', 'DD', 'ZZ')],
    wiki: [items('BB'), items('BB', 'DD')],
  };
  const fetched: string[] = [];
  const fetchSource = async (source: TrendSource): Promise<RawTrendItem[]> => {
    fetched.push(source.id);
    return lists[source.id].shift()!;
  };
  await crawlTrends(db, new Date('2026-10-14T00:00:00Z'), { fetchSource, pacer: noWaitPacer() });
  const first = buildTrendOverview(db, getTrendCrawlerConfig(db));
  assert.equal(first.genres[0].sources[0].items[0].movement.status, 'unknown');

  await crawlTrends(db, new Date('2026-10-14T03:00:00Z'), { fetchSource, pacer: noWaitPacer() });
  assert.deepEqual(fetched, ['google', 'wiki', 'google', 'wiki']);
  const overview = buildTrendOverview(db, getTrendCrawlerConfig(db));
  assert.deepEqual(overview.genres.map((g) => g.genre), ['general']);
  const google = overview.genres[0].sources.find((s) => s.sourceId === 'google')!;
  assert.deepEqual(google.items.map((i) => [i.title, i.movement.status, i.movement.delta]), [
    ['CC', 'up', 2], ['AA', 'down', -1], ['DD', 'new', null], ['ZZ', 'same', 0],
  ]);
  assert.equal(google.items[1].firstSeenAt, '2026-10-14T00:00:00.000Z');
  assert.equal(google.items[2].firstSeenAt, '2026-10-14T03:00:00.000Z');
  assert.equal(overview.lastCrawledAt, '2026-10-14T03:00:00.000Z');
  // DD は Google で新登場、 かつ Google と Wikipedia の両方に出ている (CC の上昇 2 は急上昇に入れない)。
  assert.deepEqual(overview.genres[0].highlights.map((h) => [h.title, h.reasons]), [['DD', ['cross', 'new']]]);
});

test('取得失敗は他のソースを止めず、 前回成功分を表示したまま error を載せる', async () => {
  const db = openDb();
  await crawlTrends(db, new Date('2026-10-14T00:00:00Z'), { fetchSource: async () => items('A'), pacer: noWaitPacer() });
  const result = await crawlTrends(db, new Date('2026-10-14T03:00:00Z'), {
    fetchSource: async (source) => { if (source.id === 'google') throw new Error('HTTP 503'); return items('B'); },
    pacer: noWaitPacer(),
  });
  assert.equal(result.ok, 1);
  assert.deepEqual(result.failed, [{ sourceId: 'google', error: 'HTTP 503' }]);
  const google = buildTrendOverview(db, getTrendCrawlerConfig(db)).genres[0].sources.find((s) => s.sourceId === 'google')!;
  assert.equal(google.error, 'HTTP 503');
  assert.deepEqual(google.items.map((i) => i.title), ['A']);
  assert.equal(google.fetchedAt, '2026-10-14T00:00:00.000Z');
});

test('空の一覧は失敗として扱い、 itemsPerSource で切る', async () => {
  const db = openDb({ itemsPerSource: 2 });
  const result = await crawlTrends(db, new Date('2026-10-14T00:00:00Z'), {
    fetchSource: async (source) => source.id === 'google' ? items('A', 'B', 'C') : [],
    pacer: noWaitPacer(),
  });
  assert.deepEqual(result.failed.map((f) => f.sourceId), ['wiki']);
  const google = buildTrendOverview(db, getTrendCrawlerConfig(db)).genres[0].sources[0];
  assert.equal(google.items.length, 2);
});

test('保持日数より古い履歴は巡回のたびに消える', async () => {
  const db = openDb({ retentionDays: 1 });
  await crawlTrends(db, new Date('2026-10-01T00:00:00Z'), { fetchSource: async () => items('Old'), pacer: noWaitPacer() });
  await crawlTrends(db, new Date('2026-10-14T00:00:00Z'), { fetchSource: async () => items('New'), pacer: noWaitPacer() });
  assert.equal((db.prepare('SELECT COUNT(*) AS n FROM trend_snapshots').get() as { n: number }).n, 2);
  assert.equal((db.prepare('SELECT COUNT(*) AS n FROM trend_items').get() as { n: number }).n, 2);
});

test('巡回は同じサイトが続かないように並べ、 同じサイトへは間隔を空ける', async () => {
  const db = openDb();
  setTrendCrawlerConfig(db, {
    ...DEFAULT_TREND_CRAWLER_CONFIG,
    sources: [
      { id: 'g1', name: 'G1', genre: 'news', kind: 'rss', url: 'https://news.google.com/rss/search?q=a', enabled: true },
      { id: 'g2', name: 'G2', genre: 'news', kind: 'rss', url: 'https://news.google.com/rss/search?q=b', enabled: true },
      { id: 'y1', name: 'Y1', genre: 'news', kind: 'rss', url: 'https://news.yahoo.co.jp/rss/topics/it.xml', enabled: true },
    ],
  });
  let clock = 0;
  const waits: number[] = [];
  const pacer = new HostPacer(async (ms) => { waits.push(ms); clock += ms; }, () => clock, 3_000);
  const order: string[] = [];
  await crawlTrends(db, new Date('2026-10-14T00:00:00Z'), {
    fetchSource: async (source) => { order.push(source.id); clock += 1_000; return items('A'); },
    pacer,
  });
  assert.deepEqual(order, ['g1', 'y1', 'g2']);
  // g1 から y1 の取得で 2 秒経っているので、 g2 は残り 1 秒だけ待つ。
  assert.deepEqual(waits, [1_000]);
});

test('Reddit は無認証の取得に厳しいので長めに空ける', () => {
  const pacer = new HostPacer(async () => {});
  assert.equal(pacer.gapFor('www.reddit.com'), 15_000);
  assert.equal(pacer.gapFor('news.google.com'), 3_000);
  assert.deepEqual(interleaveByHost([{ url: 'https://a.example/1' }, { url: 'https://a.example/2' }, { url: 'https://b.example/1' }]).map((s) => s.url),
    ['https://a.example/1', 'https://b.example/1', 'https://a.example/2']);
});

test('注目は複数サイト・新登場・3 位以上の急上昇から選び、 同じ話題はまとめる', () => {
  const view = (name: string, list: [string, 'new' | 'up' | 'same' | 'unknown', number | null][]): TrendSourceView => ({
    sourceId: name, name, kind: 'rss', url: 'https://x.example', fetchedAt: null, error: null,
    items: list.map(([title, status, delta], index) => ({
      rank: index + 1, title, subtitle: null, url: null, metric: null, key: title.toLowerCase(), firstSeenAt: null, movement: { status, delta },
    })),
  });
  const highlights = pickHighlights([
    view('S1', [['Same', 'same', 0], ['Up2', 'up', 2], ['Up5', 'up', 5], ['New', 'new', null], ['Cross', 'same', 0]]),
    view('S2', [['New', 'new', null]]),
  ], new Set(['cross']));
  assert.deepEqual(highlights.map((h) => [h.title, h.reasons, h.sourceName, h.rank]), [
    ['Cross', ['cross'], 'S1', 5], ['New', ['new'], 'S2', 1], ['Up5', ['up'], 'S1', 3],
  ]);
});

test('小説家になろう API: 先頭の件数を飛ばし、 並び順に合ったポイントを出す', () => {
  const json = JSON.stringify([
    { allcount: 100 },
    { title: '冤罪が晴れて', ncode: 'N0478MW', writer: 'もんきち', daily_point: 10006, weekly_point: 20000 },
    { title: '', ncode: 'N1' },
    { title: '二作目', ncode: 'bad code!', writer: '' },
  ]);
  const daily = parseNarouRanking(json, 10, 'dailypoint');
  assert.deepEqual(daily.map((i) => [i.rank, i.title, i.subtitle, i.url, i.metric]), [
    [1, '冤罪が晴れて', 'もんきち', 'https://ncode.syosetu.com/n0478mw/', '日間 10,006 pt'],
    [2, '二作目', null, null, null],
  ]);
  assert.equal(parseNarouRanking(json, 10, 'weeklypoint')[0].metric, '週間 20,000 pt');
  assert.throws(() => parseNarouRanking('{}', 5), /配列/);
  const url = new URL(narouRequestUrl('https://api.syosetu.com/novelapi/api/?order=weeklypoint', 99));
  assert.equal(url.searchParams.get('order'), 'weeklypoint');
  assert.equal(url.searchParams.get('out'), 'json');
  assert.equal(url.searchParams.get('lim'), '50');
  assert.equal(narouOrder('https://api.syosetu.com/novelapi/api/'), 'dailypoint');
  assert.throws(() => narouRequestUrl('https://example.com/api', 5), /なろう/);
});

test('shouldCrawlTrends は巡回間隔と直前の試行を見る', () => {
  const config = { ...DEFAULT_TREND_CRAWLER_CONFIG, intervalHours: 3 };
  const now = new Date('2026-10-14T06:00:00Z');
  assert.equal(shouldCrawlTrends(config, null, now, 0), true);
  assert.equal(shouldCrawlTrends(config, '2026-10-14T04:00:00Z', now, 0), false);
  assert.equal(shouldCrawlTrends(config, '2026-10-14T03:00:00Z', now, 0), true);
  assert.equal(shouldCrawlTrends(config, null, now, now.getTime() - 10 * 60_000), false);
  assert.equal(shouldCrawlTrends({ ...config, enabled: false }, null, now, 0), false);
});

test('既定のソースはすべて設定スキーマを通り、 id が重複せず、 ジャンルが定義済み', () => {
  assert.equal(trendCrawlerConfigSchema.safeParse(DEFAULT_TREND_CRAWLER_CONFIG).success, true);
  assert.equal(new Set(DEFAULT_TREND_SOURCES.map((s) => s.id)).size, DEFAULT_TREND_SOURCES.length);
  assert.ok(DEFAULT_TREND_SOURCES.every((s) => TREND_GENRES.includes(s.genre)));
  const wanted = ['fashion', 'game', 'celebrity', 'drink', 'packaged_food', 'food', 'restaurant', 'tech', 'ai', 'gadget', 'anime', 'manga', 'novel', 'news', 'stock', 'meme', 'app'];
  for (const genre of wanted) assert.ok(DEFAULT_TREND_SOURCES.some((s) => s.genre === genre), `${genre} のソースがありません`);
});

test('設定スキーマは重複 id と種類に合わない URL を弾く', () => {
  const dup = { ...DEFAULT_TREND_CRAWLER_CONFIG, sources: [SOURCES[0], SOURCES[0]] };
  assert.equal(trendCrawlerConfigSchema.safeParse(dup).success, false);
  const badApple = { ...DEFAULT_TREND_CRAWLER_CONFIG, sources: [{ ...SOURCES[0], kind: 'apple_top' }] };
  assert.equal(trendCrawlerConfigSchema.safeParse(badApple).success, false);
  const badWiki = { ...DEFAULT_TREND_CRAWLER_CONFIG, sources: [{ ...SOURCES[1], url: 'https://example.com' }] };
  assert.equal(trendCrawlerConfigSchema.safeParse(badWiki).success, false);
  const badNarou = { ...DEFAULT_TREND_CRAWLER_CONFIG, sources: [{ ...SOURCES[0], kind: 'narou_ranking' }] };
  assert.equal(trendCrawlerConfigSchema.safeParse(badNarou).success, false);
});

test('保存済み設定には、 その版より後に加わった既定ソースだけを足す', () => {
  const v1 = DEFAULT_TREND_SOURCE_RELEASES.find((release) => release.version === 1)!.sources;
  const laterIds = DEFAULT_TREND_SOURCE_RELEASES.filter((release) => release.version > 1).flatMap((release) => release.sources.map((s) => s.id));
  // 版 1 で保存し、 その後 利用者が google-trends-jp を消した設定。
  const saved: TrendCrawlerConfig = { ...DEFAULT_TREND_CRAWLER_CONFIG, defaultsVersion: 1, sources: v1.filter((s) => s.id !== 'google-trends-jp') };
  const merged = withNewDefaultSources(saved);
  assert.equal(merged.defaultsVersion, DEFAULT_TREND_CRAWLER_CONFIG.defaultsVersion);
  assert.equal(merged.sources.some((s) => s.id === 'google-trends-jp'), false);
  assert.deepEqual(merged.sources.slice(v1.length - 1).map((s) => s.id), laterIds);
  // 既に最新版なら何も足さない (利用者が消したソースを戻さない)。
  const latest = { ...merged, sources: merged.sources.filter((s) => s.genre !== 'youth') };
  assert.equal(withNewDefaultSources(latest).sources.some((s) => s.genre === 'youth'), false);
});

test('読み込み時に古い版の保存設定へ新しいジャンルのソースが加わる', () => {
  const db = openDb();
  db.prepare('UPDATE app_settings SET value = ? WHERE key = ?').run(
    JSON.stringify({ ...DEFAULT_TREND_CRAWLER_CONFIG, defaultsVersion: 2, sources: SOURCES, summarize: true }), 'trend_crawler.config',
  );
  const config = getTrendCrawlerConfig(db);
  const v3 = DEFAULT_TREND_SOURCE_RELEASES.find((release) => release.version === 3)!.sources;
  assert.equal(config.sources.length, SOURCES.length + v3.length);
  assert.equal('summarize' in config, false);
  assert.equal(trendCrawlerConfigSchema.safeParse(config).success, true);
});
