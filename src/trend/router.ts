import type BetterSqlite3 from 'better-sqlite3';
import { Hono, type Context } from 'hono';
import { isSameMachineRequest } from '../runtime/local-request.ts';

/** 何を書き換える要求か。 site = 設定・巡回、 personal = 本人の好み (興味・開いた記録)。 */
export type TrendScope = 'site' | 'personal';

/** ログインしている人 (Cernere の sub)。 */
export interface TrendUser {
  userId: string;
  displayName: string | null;
}

/** 要求を通すかどうか。 既定は同じ端末だけ (公開の入口は src/runtime/access-gate.ts が判定を差し替える)。 */
export type TrendAuthorize = (context: Context, scope?: TrendScope) => Promise<
  { ok: true; canEdit: boolean; user?: TrendUser } | { ok: false; status: 403 | 503; reason: string }
>;

const sameMachineOnly: TrendAuthorize = async (context) => (isSameMachineRequest(context)
  ? { ok: true, canEdit: true }
  : { ok: false, status: 403, reason: 'same-machine access required' });
import {
  findTrendSource,
  getTrendCrawlerConfig,
  setTrendCrawlerConfig,
  trendCrawlerConfigSchema,
} from './config.ts';
import { trendCrawlCoordinator, type TrendCrawlCoordinator } from './coordinator.ts';
import { clickInputSchema, clickStats, getInterestPrefs, interestPrefsSchema, recordClick, setInterestPrefs } from './interest-store.ts';
import type { TrendInterestPrefs } from './interest.ts';
import { buildTrendMap, type TrendMap } from './map.ts';
import { buildTrendOverview } from './overview.ts';
import { getUserPrefs, recordUserClick, setUserPrefs, userClickStats, userTendency } from './personal-store.ts';
import { crawlTrends } from './service.ts';
import type { TrendCrawlerConfig, TrendCrawlResult, TrendGenre, TrendOverview } from './types.ts';

type Db = BetterSqlite3.Database;

export interface TrendCrawlerRouterDeps {
  db: Db;
  crawl?: (db: Db, onlySourceId?: string) => Promise<TrendCrawlResult>;
  overview?: (db: Db) => TrendOverview;
  map?: (db: Db, userId: string | null) => TrendMap;
  coordinator?: TrendCrawlCoordinator;
  authorize?: TrendAuthorize;
}

/** 本人の好みを書き換える要求 (ログインした人は公開 URL からでも書ける)。 */
function scopeOf(context: Context): TrendScope {
  const method = context.req.method.toUpperCase();
  const path = context.req.path;
  return (method === 'PUT' && path === '/api/trend-crawler/interest') || (method === 'POST' && path === '/api/trend-crawler/click')
    ? 'personal' : 'site';
}

export function makeTrendCrawlerRouter(deps: TrendCrawlerRouterDeps): Hono {
  const router = new Hono();
  const crawl = deps.crawl ?? ((db: Db, onlySourceId?: string) => crawlTrends(db, new Date(), {}, onlySourceId));
  const overview = deps.overview ?? ((db: Db) => buildTrendOverview(db, getTrendCrawlerConfig(db)));
  const coordinator = deps.coordinator ?? trendCrawlCoordinator;
  const authorize = deps.authorize ?? sameMachineOnly;
  // ログインした人には、 その人の興味と開いた記録だけで大きさを決めたマップを返す (偏向学習)。
  const map = deps.map ?? ((db: Db, userId: string | null) => (userId
    ? buildTrendMap(overview(db), getUserPrefs(db, userId), userClickStats(db, userId))
    : buildTrendMap(overview(db), getInterestPrefs(db), clickStats(db))));
  const userOf = async (context: Context): Promise<TrendUser | null> => {
    const decision = await authorize(context, scopeOf(context));
    return decision.ok ? decision.user ?? null : null;
  };

  router.use('/api/trend-crawler/*', async (context, next) => {
    context.header('Cache-Control', 'no-store');
    const decision = await authorize(context, scopeOf(context));
    if (!decision.ok) return context.json({ error: decision.reason }, decision.status);
    await next();
  });

  // 画面が操作のボタンを出すかどうか。 canEdit = 巡回・設定 (公開 URL からの閲覧では false)、
  // canPersonalize = 興味の設定と開いた記録 (同じ端末か、 ログインした人)。
  router.get('/api/trend-crawler/access', async (context: Context) => {
    const decision = await authorize(context);
    const user = decision.ok ? decision.user ?? null : null;
    const canEdit = decision.ok && decision.canEdit;
    return context.json({ canEdit, canPersonalize: canEdit || user !== null, user: user ? { displayName: user.displayName } : null });
  });

  // ログインした本人の好みの傾向。 本人の分だけを返す。
  router.get('/api/trend-crawler/tendency', async (context: Context) => {
    const user = await userOf(context);
    if (!user) return context.json({ error: 'ログインすると自分の好みの傾向を見られます' }, 401);
    return context.json({ tendency: userTendency(deps.db, user.userId) });
  });

  router.get('/api/trend-crawler/config', (context: Context) => context.json(getTrendCrawlerConfig(deps.db)));

  router.put('/api/trend-crawler/config', async (context: Context) => {
    const body = await context.req.json().catch(() => null);
    const parsed = trendCrawlerConfigSchema.safeParse(body);
    if (!parsed.success) return context.json({ error: 'invalid trend-crawler config', issues: parsed.error.issues }, 400);
    return context.json(setTrendCrawlerConfig(deps.db, parsed.data as TrendCrawlerConfig));
  });

  router.get('/api/trend-crawler/overview', (context: Context) => context.json({
    overview: overview(deps.db),
    busy: coordinator.busy,
  }));

  router.get('/api/trend-crawler/map', async (context: Context) => {
    const user = await userOf(context);
    return context.json({ map: map(deps.db, user?.userId ?? null), busy: coordinator.busy });
  });

  router.get('/api/trend-crawler/interest', async (context: Context) => {
    const user = await userOf(context);
    return context.json(user ? getUserPrefs(deps.db, user.userId) : getInterestPrefs(deps.db));
  });

  // ログインした人はその人の設定を、 そうでなければ (同じ端末から) サイトの既定を書き換える。
  router.put('/api/trend-crawler/interest', async (context: Context) => {
    const body = await context.req.json().catch(() => null);
    const parsed = interestPrefsSchema.safeParse(body);
    if (!parsed.success) return context.json({ error: 'invalid interest prefs', issues: parsed.error.issues }, 400);
    const prefs = parsed.data as TrendInterestPrefs;
    const user = await userOf(context);
    return context.json(user ? setUserPrefs(deps.db, user.userId, prefs) : setInterestPrefs(deps.db, prefs));
  });

  router.post('/api/trend-crawler/click', async (context: Context) => {
    const body = await context.req.json().catch(() => null);
    const parsed = clickInputSchema.safeParse(body);
    if (!parsed.success) return context.json({ error: 'invalid click', issues: parsed.error.issues }, 400);
    const click = { ...parsed.data, genre: parsed.data.genre as TrendGenre };
    const user = await userOf(context);
    if (user) recordUserClick(deps.db, user.userId, click);
    else recordClick(deps.db, click);
    return context.json({ ok: true });
  });

  router.post('/api/trend-crawler/refresh', async (context: Context) => {
    const sourceId = context.req.query('source') || undefined;
    if (sourceId && !findTrendSource(getTrendCrawlerConfig(deps.db), sourceId)) {
      return context.json({ error: 'unknown source' }, 404);
    }
    const request = coordinator.request(() => crawl(deps.db, sourceId));
    if (request.status === 'busy') return context.json({ error: 'trend crawl already running' }, 409);
    const result = await request.promise;
    return context.json({ result, overview: overview(deps.db) });
  });

  return router;
}
