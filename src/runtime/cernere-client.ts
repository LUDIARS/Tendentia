// Cernere とのやり取り (ログインのときだけ)。 authCode → ユーザー token → Tendentia 向けの project token、
// と project token を検証する公開鍵の取得。 手順は Aedilis と同じ (Cernere docs/composite_design.md)。

import type { KeyObject } from 'node:crypto';
import { ed25519PublicKey, verifyPasetoV4Public } from './paseto-v4.ts';

export const CERNERE_PROJECT_KEY = 'tendentia';
const TIMEOUT_MS = 10_000;
/** 公開鍵はこれより古ければ取り直す (Cernere の鍵の入れ替えに追いつく)。 */
const KEY_TTL_MS = 6 * 60 * 60 * 1000;

export interface CernereIdentity {
  userId: string;
  displayName: string | null;
}

export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

export class LoginError extends Error {
  readonly status: 400 | 401 | 403 | 503;
  constructor(status: 400 | 401 | 403 | 503, message: string) {
    super(message);
    this.status = status;
  }
}

export class CernereClient {
  private readonly baseUrl: string;
  private readonly fetchImpl: FetchLike;
  private keys: KeyObject[] = [];
  private keysAt = 0;

  constructor(baseUrl: string, fetchImpl: FetchLike = fetch) {
    this.baseUrl = baseUrl;
    this.fetchImpl = fetchImpl;
  }

  private async post(path: string, body: unknown, bearer?: string): Promise<Response> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (bearer) headers.Authorization = `Bearer ${bearer}`;
    return this.fetchImpl(new URL(path, this.baseUrl).toString(), {
      method: 'POST', headers, body: JSON.stringify(body), redirect: 'error', signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  }

  private async publicKeys(force = false): Promise<KeyObject[]> {
    if (!force && this.keys.length > 0 && Date.now() - this.keysAt < KEY_TTL_MS) return this.keys;
    const response = await this.fetchImpl(new URL('/.well-known/cernere-public-key', this.baseUrl).toString(), {
      redirect: 'error', signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!response.ok) throw new LoginError(503, 'Cernere の公開鍵を取得できません');
    const body = await response.json().catch(() => null) as { keys?: { public_key?: unknown }[] } | null;
    const keys = (body?.keys ?? [])
      .map((entry) => (typeof entry?.public_key === 'string' ? ed25519PublicKey(entry.public_key) : null))
      .filter((key): key is KeyObject => key !== null);
    if (keys.length === 0) throw new LoginError(503, 'Cernere の公開鍵が空です');
    this.keys = keys;
    this.keysAt = Date.now();
    return keys;
  }

  /** composite ログインの authCode から、 Tendentia 向けに検証済みの利用者を得る。 */
  async login(code: string, audience: string): Promise<CernereIdentity> {
    const exchange = await this.post('/api/auth/exchange', { code });
    if (!exchange.ok) throw new LoginError(401, 'ログインが失効しました。もう一度お試しください');
    const user = await exchange.json().catch(() => null) as { accessToken?: unknown } | null;
    if (typeof user?.accessToken !== 'string') throw new LoginError(503, 'Cernere から認証情報を取得できません');

    const project = await this.post('/api/auth/project-token', { project_key: CERNERE_PROJECT_KEY, hub_url: audience }, user.accessToken);
    if (!project.ok) throw new LoginError(503, 'Cernere に Tendentia が登録されていません');
    const token = await project.json().catch(() => null) as { accessToken?: unknown } | null;
    if (typeof token?.accessToken !== 'string') throw new LoginError(503, 'Cernere の応答形式が不正です');

    // 鍵の入れ替え直後は古い鍵で落ちるので、 1 回だけ取り直して確かめる。
    const claims = verifyPasetoV4Public(token.accessToken, await this.publicKeys(), { audience })
      ?? verifyPasetoV4Public(token.accessToken, await this.publicKeys(true), { audience });
    if (!claims || claims.kind !== 'user_for_project' || claims.projectKey !== CERNERE_PROJECT_KEY || typeof claims.sub !== 'string' || !claims.sub) {
      throw new LoginError(401, 'Cernere の認証を確かめられませんでした');
    }
    const name = typeof claims.displayName === 'string' ? claims.displayName.trim().slice(0, 80) : '';
    return { userId: claims.sub, displayName: name || null };
  }
}
