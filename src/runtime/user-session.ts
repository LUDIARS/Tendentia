// Tendentia のログイン cookie (td_session)。 Cernere で確かめた利用者を 30 日覚える。
// 中身は「利用者 id・表示名・期限」を base64url にした JSON で、 data dir の session.key で HMAC-SHA256 署名する。
// 鍵は初回起動時に乱数で作り (0600)、 data dir の外へは出さない。 鍵を消すと全員ログアウトになる。

import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export const SESSION_COOKIE = 'td_session';
export const SESSION_TTL_SECONDS = 30 * 24 * 60 * 60;
const KEY_FILE = 'session.key';
const KEY_BYTES = 32;

export interface SessionUser {
  userId: string;
  displayName: string | null;
}

/** data dir の鍵を読む。 無ければ作る。 */
export function loadSessionKey(dataDir: string): Buffer {
  const path = join(dataDir, KEY_FILE);
  if (existsSync(path)) {
    const key = Buffer.from(readFileSync(path, 'utf8').trim(), 'base64');
    if (key.length === KEY_BYTES) return key;
    throw new Error(`${KEY_FILE} が壊れています (消すと全員ログアウトして作り直します)`);
  }
  const key = randomBytes(KEY_BYTES);
  writeFileSync(path, key.toString('base64'), { mode: 0o600, flag: 'wx' });
  return key;
}

export class SessionSigner {
  private readonly key: Buffer;
  private readonly clock: () => number;

  constructor(key: Buffer, clock: () => number = Date.now) {
    this.key = key;
    this.clock = clock;
  }

  private sign(body: string): string {
    return createHmac('sha256', this.key).update(body).digest('base64url');
  }

  issue(user: SessionUser): string {
    const body = Buffer.from(JSON.stringify({
      sub: user.userId, name: user.displayName, exp: Math.floor(this.clock() / 1000) + SESSION_TTL_SECONDS,
    })).toString('base64url');
    return `${body}.${this.sign(body)}`;
  }

  /** 署名と期限が正しければ利用者を返す。 改ざん・期限切れ・形の誤りは null (匿名として扱う)。 */
  read(value: string | undefined): SessionUser | null {
    if (!value || value.length > 2_000) return null;
    const [body, signature, extra] = value.split('.');
    if (!body || !signature || extra !== undefined) return null;
    const expected = Buffer.from(this.sign(body));
    const given = Buffer.from(signature);
    if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
    try {
      const claims = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as { sub?: unknown; name?: unknown; exp?: unknown };
      if (typeof claims.sub !== 'string' || !claims.sub || typeof claims.exp !== 'number') return null;
      if (claims.exp * 1000 <= this.clock()) return null;
      return { userId: claims.sub, displayName: typeof claims.name === 'string' ? claims.name : null };
    } catch {
      return null;
    }
  }
}

/** Cookie ヘッダから 1 つの値を取り出す。 */
export function readCookie(header: string | undefined, name: string): string | undefined {
  for (const part of (header ?? '').split(';')) {
    const index = part.indexOf('=');
    if (index > 0 && part.slice(0, index).trim() === name) {
      try { return decodeURIComponent(part.slice(index + 1).trim()); } catch { return undefined; }
    }
  }
  return undefined;
}
