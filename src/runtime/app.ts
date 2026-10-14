// HTTP の入口。 health・トレンド API・ビルド済み画面の配信を 1 つの Hono アプリにまとめる。
// health 以外は入口の判定 (access-gate.ts) を通す: 同じ端末からは今まで通り、 公開 URL からは Cloudflare Access の JWT が要る。

import type BetterSqlite3 from 'better-sqlite3';
import { Hono } from 'hono';
import { makeSyncRouter } from '../trend/replica/router.ts';
import { makeTrendCrawlerRouter } from '../trend/router.ts';
import { AccessGate } from './access-gate.ts';
import { makeStaticHandler } from './static.ts';

type Db = BetterSqlite3.Database;

export interface AppDeps {
  db: Db;
  webDir: string;
  version: string;
  /** 省略時は公開の入口なし (同じ端末だけ)。 */
  gate?: AccessGate;
  /** collector だけ写しの書き出し口 (GET /api/sync/export) を出す。 */
  syncExport?: boolean;
}

export function makeApp(deps: AppDeps): Hono {
  const app = new Hono();
  const gate = deps.gate ?? new AccessGate({ entrance: { origin: null, hosts: [] } });
  app.get('/health', (context) => context.json({ ok: true, service: 'tendentia', version: deps.version }));
  const authorize = (context: Parameters<AccessGate['decide']>[0]) => gate.decide(context);
  app.route('/', makeTrendCrawlerRouter({ db: deps.db, authorize }));
  if (deps.syncExport) app.route('/', makeSyncRouter({ db: deps.db, authorize }));
  const serveStatic = makeStaticHandler(deps.webDir);
  app.get('*', async (context) => {
    const decision = await gate.decide(context);
    if (!decision.ok) return context.text(decision.reason, decision.status);
    return serveStatic(context);
  });
  return app;
}
