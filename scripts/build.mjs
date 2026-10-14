// ビルド: サーバ (src/main.ts → dist/server.js) と画面 (web → dist/web)。
// 依存パッケージは束ねない (better-sqlite3 はネイティブなので node_modules から読む)。

import { copyFile, mkdir, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const root = fileURLToPath(new URL('../', import.meta.url));
const dist = `${root}dist`;

await rm(dist, { recursive: true, force: true });
await mkdir(`${dist}/web`, { recursive: true });

await build({
  entryPoints: [`${root}src/main.ts`],
  outfile: `${dist}/server.js`,
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  packages: 'external',
  sourcemap: true,
  logLevel: 'warning',
});

await build({
  entryPoints: [`${root}web/src/main.ts`],
  outfile: `${dist}/web/app.js`,
  bundle: true,
  platform: 'browser',
  format: 'esm',
  target: 'es2020',
  sourcemap: true,
  logLevel: 'warning',
});

await copyFile(`${root}web/index.html`, `${dist}/web/index.html`);
await copyFile(`${root}web/style.css`, `${dist}/web/style.css`);
console.log('tendentia build: dist/server.js, dist/web/');
