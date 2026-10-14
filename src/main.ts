// Tendentia の起動。 設定を読み、 DB を開き、 HTTP と、 役割に応じて定期巡回 (collector) か本社からの写し (viewer) を始める。
// 常駐の起動・停止は Excubitor が行う。

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { serve } from '@hono/node-server';
import { AccessGate, publicEntrance } from './runtime/access-gate.ts';
import { makeApp } from './runtime/app.ts';
import { CfAccessVerifier, readCfAccessConfig } from './runtime/cf-access.ts';
import { readRuntimeConfig } from './runtime/config.ts';
import { openDatabase } from './runtime/db.ts';
import { startReplicaPuller } from './trend/replica/puller.ts';
import { startTrendCrawlerScheduler } from './trend/scheduler.ts';

// dist/server.js から見たリポジトリ直下。
const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const version = (JSON.parse(readFileSync(resolve(rootDir, 'package.json'), 'utf8')) as { version?: string }).version ?? '0.0.0';

const config = readRuntimeConfig(process.env, rootDir);
const db = openDatabase(config.dataDir);
// 公開の入口: 公開 URL / 許可 Host と Cloudflare Access の設定 (どちらも無ければ同じ端末だけ)。 設定の誤りは起動時に止める。
const entrance = publicEntrance(process.env);
const cfAccess = readCfAccessConfig(process.env);
const viewer = config.role === 'viewer';
const gate = new AccessGate({ entrance, verifier: cfAccess ? new CfAccessVerifier(cfAccess) : undefined, readOnly: viewer });
const app = makeApp({ db, webDir: config.webDir, version, gate, syncExport: !viewer });

serve({ fetch: app.fetch, hostname: config.host, port: config.port }, (info) => {
  console.log(`[tendentia] ${config.role} listening on http://${config.host}:${info.port} (data: ${config.dataDir})`);
  console.log(`[tendentia] public entrance: ${entrance.origin ?? 'none'} / Cloudflare Access: ${cfAccess ? 'configured' : 'not configured (public requests get 503)'}`);
});
if (viewer) startReplicaPuller(db, config.upstreamUrl!);
else startTrendCrawlerScheduler(db);

const shutdown = (): void => {
  try { db.close(); } catch { /* 既に閉じている */ }
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
