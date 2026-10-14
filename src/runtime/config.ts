// 起動設定は環境変数だけから読む。 ポート番号の正本は excubitor.catalog.yaml で、 ここに既定値は持たない。

import { isAbsolute, resolve } from 'node:path';

/**
 * 役割。 collector = 巡回して集める (本社)。 viewer = 本社から写して見せるだけ (AWS。 巡回も変更もしない)。
 * 2026-10-14 neco「Td は AWS に置きます」「巡回と収集は本社で」。
 */
export type TendentiaRole = 'collector' | 'viewer';

export interface RuntimeConfig {
  role: TendentiaRole;
  /** viewer が写しを取りに行く collector の URL (https の Origin)。 */
  upstreamUrl: string | null;
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
  const roleRaw = env.TENDENTIA_ROLE?.trim() || 'collector';
  if (roleRaw !== 'collector' && roleRaw !== 'viewer') throw new Error('TENDENTIA_ROLE は collector か viewer で指定してください');
  const upstreamUrl = roleRaw === 'viewer' ? parseUpstream(env.TENDENTIA_UPSTREAM_URL) : null;
  return { role: roleRaw, upstreamUrl, host, port, dataDir, webDir: resolve(rootDir, 'dist', 'web') };
}

function parseUpstream(value: string | undefined): string {
  let url: URL;
  try { url = new URL(value?.trim() ?? ''); } catch { throw new Error('viewer には TENDENTIA_UPSTREAM_URL (本社の Tendentia の https URL) が必要です'); }
  if (url.protocol !== 'https:') throw new Error('TENDENTIA_UPSTREAM_URL は https で指定してください');
  return url.origin;
}
