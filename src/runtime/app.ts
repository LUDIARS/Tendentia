// HTTP の入口。 health・トレンド API・ビルド済み画面の配信を 1 つの Hono アプリにまとめる。
// health 以外は入口の判定 (access-gate.ts) を通す: 同じ端末からは今まで通り、 公開 URL からは Cloudflare Access の JWT が要る。

import type BetterSqlite3 from 'better-sqlite3';
import { Hono } from 'hono';
import { makeTrendCrawlerRouter } from '../trend/router.js';
import { AccessGate } from './access-gate.js';
import { makeStaticHandler } from './static.js';

type Db = BetterSqlite3.Database;

export interface AppDeps {
  db: Db;
  webDir: string;
  version: string;
  /** 省略時は公開の入口なし (同じ端末だけ)。 */
  gate?: AccessGate;
}

export function makeApp(deps: AppDeps): Hono {
  const app = new Hono();
  const gate = deps.gate ?? new AccessGate({ entrance: { origin: null, hosts: [] } });
  app.get('/health', (context) => context.json({ ok: true, service: 'tendentia', version: deps.version }));
  app.route('/', makeTrendCrawlerRouter({ db: deps.db, authorize: (context) => gate.decide(context) }));
  const serveStatic = makeStaticHandler(deps.webDir);
  app.get('*', async (context) => {
    const decision = await gate.decide(context);
    if (!decision.ok) return context.text(decision.reason, decision.status);
    return serveStatic(context);
  });
  return app;
}
