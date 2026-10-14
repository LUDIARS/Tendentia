// Tendentia の起動。 設定を読み、 DB を開き、 HTTP と定期巡回を始める。 常駐の起動・停止は Excubitor が行う。

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { serve } from '@hono/node-server';
import { makeApp } from './runtime/app.js';
import { readRuntimeConfig } from './runtime/config.js';
import { openDatabase } from './runtime/db.js';
import { startTrendCrawlerScheduler } from './trend/scheduler.js';

// dist/server.js から見たリポジトリ直下。
const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const version = (JSON.parse(readFileSync(resolve(rootDir, 'package.json'), 'utf8')) as { version?: string }).version ?? '0.0.0';

const config = readRuntimeConfig(process.env, rootDir);
const db = openDatabase(config.dataDir);
const app = makeApp({ db, webDir: config.webDir, version });

serve({ fetch: app.fetch, hostname: config.host, port: config.port }, (info) => {
  console.log(`[tendentia] listening on http://${config.host}:${info.port} (data: ${config.dataDir})`);
});
startTrendCrawlerScheduler(db);

const shutdown = (): void => {
  try { db.close(); } catch { /* 既に閉じている */ }
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
