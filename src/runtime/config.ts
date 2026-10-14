// 起動設定は環境変数だけから読む。 ポート番号の正本は excubitor.catalog.yaml で、 ここに既定値は持たない。

import { isAbsolute, resolve } from 'node:path';

export interface RuntimeConfig {
  host: string;
  port: number;
  dataDir: string;
  /** ビルド済みの画面 (dist/web) の場所。 */
  webDir: string;
}

export function readRuntimeConfig(env: NodeJS.ProcessEnv, rootDir: string): RuntimeConfig {
  const port = Number(env.TENDENTIA_PORT);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error('TENDENTIA_PORT が未設定か不正です (Excubitor catalog から渡す)');
  }
  const host = env.TENDENTIA_HOST?.trim() || '127.0.0.1';
  const dataDirRaw = env.TENDENTIA_DATA_DIR?.trim() || 'data';
  const dataDir = isAbsolute(dataDirRaw) ? dataDirRaw : resolve(rootDir, dataDirRaw);
  return { host, port, dataDir, webDir: resolve(rootDir, 'dist', 'web') };
}
