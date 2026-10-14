// collector 側の書き出し口。 GET /api/sync/export?after=<snapshot id>。
// 読み出しだけなので、 入口の判定 (公開 URL からは閲覧のみ) をそのまま通る。

import type BetterSqlite3 from 'better-sqlite3';
import { Hono, type Context } from 'hono';
import type { TrendAuthorize } from '../router.ts';
import { exportSince } from './export.ts';

type Db = BetterSqlite3.Database;

export function makeSyncRouter(deps: { db: Db; authorize: TrendAuthorize }): Hono {
  const router = new Hono();
  router.get('/api/sync/export', async (context: Context) => {
    context.header('Cache-Control', 'no-store');
    const decision = await deps.authorize(context);
    if (!decision.ok) return context.json({ error: decision.reason }, decision.status);
    const after = Number(context.req.query('after') ?? '0');
    if (!Number.isInteger(after) || after < 0) return context.json({ error: 'after は 0 以上の整数で指定してください' }, 400);
    return context.json(exportSince(deps.db, { snapshot: after }));
  });
  return router;
}
