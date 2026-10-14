// HTTP の入口。 health・トレンド API・ビルド済み画面の配信を 1 つの Hono アプリにまとめる。

import type BetterSqlite3 from 'better-sqlite3';
import { Hono } from 'hono';
import { makeTrendCrawlerRouter } from '../trend/router.js';
import { makeStaticHandler } from './static.js';

type Db = BetterSqlite3.Database;

export interface AppDeps {
  db: Db;
  webDir: string;
  version: string;
}

export function makeApp(deps: AppDeps): Hono {
  const app = new Hono();
  app.get('/health', (context) => context.json({ ok: true, service: 'tendentia', version: deps.version }));
  app.route('/', makeTrendCrawlerRouter({ db: deps.db }));
  app.get('*', makeStaticHandler(deps.webDir));
  return app;
}
