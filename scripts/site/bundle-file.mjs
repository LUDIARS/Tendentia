// 移行ファイルの読み書きと、 データの置き場所の解決。

import { createHash, timingSafeEqual } from 'node:crypto';
import { lstat, open, writeFile } from 'node:fs/promises';
import { isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertBundle, MAX_BUNDLE_BYTES } from './data-bundle.mjs';

export const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url));
export const DB_FILE = 'tendentia.db';

/** catalog と同じく TENDENTIA_DATA_DIR を優先し、 無ければリポジトリ直下の data/。 */
export function dataDir(env = process.env) {
  const raw = env.TENDENTIA_DATA_DIR?.trim();
  if (!raw) return join(REPO_ROOT, 'data');
  return isAbsolute(raw) ? raw : resolve(REPO_ROOT, raw);
}

export function dbPath(env = process.env) {
  return join(dataDir(env), DB_FILE);
}

/** 既にあるファイルは上書きしない (wx)。 書いた内容の sha256 を返す。 */
export async function writeBundleFile(output, bundle) {
  const text = `${JSON.stringify(bundle)}\n`;
  if (Buffer.byteLength(text) > MAX_BUNDLE_BYTES) throw new Error('data bundle is larger than the format allows');
  await writeFile(output, text, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

/** 通常ファイルであること・読んでいる間に差し替わっていないこと・sha256 が合うことを確かめてから解釈する。 */
export async function readVerifiedBundle(input, sha256) {
  if (!/^[a-f0-9]{64}$/i.test(sha256)) throw new Error('--sha256 must be 64 hex digits');
  const linkInfo = await lstat(input);
  if (!linkInfo.isFile() || linkInfo.isSymbolicLink() || linkInfo.size > MAX_BUNDLE_BYTES) throw new Error('input is not a regular file within the size limit');
  const file = await open(input, 'r');
  let bytes;
  try {
    const info = await file.stat();
    if (!info.isFile() || info.size !== linkInfo.size || info.dev !== linkInfo.dev || info.ino !== linkInfo.ino) throw new Error('input changed while reading');
    bytes = Buffer.alloc(info.size);
    const { bytesRead } = await file.read(bytes, 0, info.size, 0);
    if (bytesRead !== info.size) throw new Error('input changed while reading');
  } finally {
    await file.close();
  }
  const digest = createHash('sha256').update(bytes).digest();
  if (!timingSafeEqual(digest, Buffer.from(sha256, 'hex'))) throw new Error('sha256 mismatch');
  const bundle = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  assertBundle(bundle);
  return bundle;
}
