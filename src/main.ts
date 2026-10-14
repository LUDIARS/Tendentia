// Tendentia の起動。 設定を読み、 DB を開き、 HTTP と定期巡回を始める。 常駐の起動・停止は Excubitor が行う。

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { serve } from '@hono/node-server';
import { AccessGate, publicEntrance } from './runtime/access-gate.js';
import { makeApp } from './runtime/app.js';
import { CfAccessVerifier, readCfAccessConfig } from './runtime/cf-access.js';
import { readRuntimeConfig } from './runtime/config.js';
import { openDatabase } from './runtime/db.js';
import { startTrendCrawlerScheduler } from './trend/scheduler.js';

// dist/server.js から見たリポジトリ直下。
const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const version = (JSON.parse(readFileSync(resolve(rootDir, 'package.json'), 'utf8')) as { version?: string }).version ?? '0.0.0';

const config = readRuntimeConfig(process.env, rootDir);
const db = openDatabase(config.dataDir);
// 公開の入口: 公開 URL / 許可 Host と Cloudflare Access の設定 (どちらも無ければ同じ端末だけ)。 設定の誤りは起動時に止める。
const entrance = publicEntrance(process.env);
const cfAccess = readCfAccessConfig(process.env);
const gate = new AccessGate({ entrance, verifier: cfAccess ? new CfAccessVerifier(cfAccess) : undefined });
const app = makeApp({ db, webDir: config.webDir, version, gate });

serve({ fetch: app.fetch, hostname: config.host, port: config.port }, (info) => {
  console.log(`[tendentia] listening on http://${config.host}:${info.port} (data: ${config.dataDir})`);
  console.log(`[tendentia] public entrance: ${entrance.origin ?? 'none'} / Cloudflare Access: ${cfAccess ? 'configured' : 'not configured (public requests get 503)'}`);
});
startTrendCrawlerScheduler(db);

const shutdown = (): void => {
  try { db.close(); } catch { /* 既に閉じている */ }
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
