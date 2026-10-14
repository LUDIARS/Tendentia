// Excubitor setup: 依存の導入・型チェック・ビルド (dist/) と、データ置き場の用意。
// 再実行できる。既存データ (data/tendentia.db) は触らない。常駐の起動は Excubitor に任せる。

import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { runNpm } from './npm.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));

try {
  await runNpm(root, ['ci', '--include=dev', '--no-audit', '--no-fund']);
  await runNpm(root, ['run', 'typecheck']);
  await runNpm(root, ['run', 'build']);
  await mkdir(new URL('../../data/', import.meta.url), { recursive: true });
} catch (error) {
  process.stderr.write(`tendentia setup failed: ${error.message}\n`);
  process.exitCode = 1;
}
