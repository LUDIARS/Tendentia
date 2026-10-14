// Cloudflare Access の JWT (Cf-Access-Jwt-Assertion) を、 チームが公開している署名鍵で検証する。
// 設定は Excubitor の runtime-config (EXCUBITOR_SERVICE_CONFIG_JSON の cloudflareAccess) か、
// 明示の TENDENTIA_CF_ACCESS_TEAM_DOMAIN / TENDENTIA_CF_ACCESS_AUD (2 つ揃いで優先)。
// Elegantia src/runtime/cf-access.ts と Breviarium の設定の読み方を土台にした。

import type { JsonWebKey } from 'node:crypto';
import { decodeJwt, verifyRs256 } from './cf-jwt.ts';

export interface CfAccessConfig {
  /** `https://<team>.cloudflareaccess.com` (JWT の iss と鍵の取得元)。 */
  issuer: string;
  /** Access application の AUD タグ。 */
  audience: string;
}

export interface CfIdentity { email?: string }
export type JwksFetcher = (url: string) => Promise<unknown>;

const TEAM_DOMAIN = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.cloudflareaccess\.com$/i;
const AUDIENCE = /^[a-f0-9]{32,128}$/i;

function pairFromServiceConfig(serialized: string | undefined): { team?: string; audience?: string } {
  if (!serialized?.trim()) return {};
  let config: unknown;
  try { config = JSON.parse(serialized); } catch { throw new Error('EXCUBITOR_SERVICE_CONFIG_JSON が JSON ではありません'); }
  if (typeof config !== 'object' || config === null || !('cloudflareAccess' in config)) return {};
  const access = (config as { cloudflareAccess: unknown }).cloudflareAccess;
  if (typeof access !== 'object' || access === null) throw new Error('cloudflareAccess の形が不正です');
  const { teamDomain, audience } = access as { teamDomain?: unknown; audience?: unknown };
  return {
    team: typeof teamDomain === 'string' ? teamDomain.trim() : undefined,
    audience: typeof audience === 'string' ? audience.trim() : undefined,
  };
}

/** 両方そろって初めて有効。 片方だけ・形が違うときは起動時に止める (黙って公開しない)。 どちらも無ければ undefined。 */
export function readCfAccessConfig(env: NodeJS.ProcessEnv): CfAccessConfig | undefined {
  const explicitTeam = env.TENDENTIA_CF_ACCESS_TEAM_DOMAIN?.trim();
  const explicitAudience = env.TENDENTIA_CF_ACCESS_AUD?.trim();
  const { team, audience } = explicitTeam || explicitAudience
    ? { team: explicitTeam, audience: explicitAudience }
    : pairFromServiceConfig(env.EXCUBITOR_SERVICE_CONFIG_JSON);
  if (!team && !audience) return undefined;
  if (!team || !audience) throw new Error('Cloudflare Access の team domain と AUD は 2 つそろえて設定してください');
  const host = team.replace(/^https:\/\//i, '').replace(/\/$/, '');
  if (!TEAM_DOMAIN.test(host)) throw new Error('Cloudflare Access の team domain は <team>.cloudflareaccess.com 形式で指定してください');
  if (!AUDIENCE.test(audience)) throw new Error('Cloudflare Access の AUD タグの形が不正です');
  return { issuer: `https://${host.toLowerCase()}`, audience: audience.toLowerCase() };
}

const KEY_TTL_MS = 10 * 60 * 1000;
const UNKNOWN_KID_RETRY_MS = 60 * 1000;
const MAX_ASSERTION_LENGTH = 8192;

async function fetchJwksDefault(url: string): Promise<unknown> {
  const response = await fetch(url, { signal: AbortSignal.timeout(5000), headers: { accept: 'application/json' } });
  if (!response.ok) throw new Error('JWKS fetch failed');
  return response.json();
}

function claimsAccepted(payload: Record<string, unknown>, config: CfAccessConfig, nowMs: number): boolean {
  const now = Math.floor(nowMs / 1000);
  const audiences = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  return payload.iss === config.issuer && audiences.includes(config.audience)
    && typeof payload.exp === 'number' && payload.exp > now
    && (payload.nbf === undefined || (typeof payload.nbf === 'number' && payload.nbf <= now));
}

export class CfAccessVerifier {
  private readonly keys = new Map<string, JsonWebKey>();
  private fetchedAt = -Infinity;
  private inflight?: Promise<void>;

  private readonly config: CfAccessConfig;
  private readonly fetchJwks: JwksFetcher;
  private readonly now: () => number;

  constructor(config: CfAccessConfig, fetchJwks: JwksFetcher = fetchJwksDefault, now: () => number = () => Date.now()) {
    this.config = config;
    this.fetchJwks = fetchJwks;
    this.now = now;
  }

  /** 正しい JWT なら利用者 (email) を返す。 不正・期限切れ・別アプリ向けは undefined。 例外は投げない。 */
  async verify(assertion: string | undefined): Promise<CfIdentity | undefined> {
    if (!assertion || assertion.length > MAX_ASSERTION_LENGTH) return undefined;
    const parts = decodeJwt(assertion);
    if (!parts || typeof parts.header.kid !== 'string') return undefined;
    const key = await this.keyFor(parts.header.kid);
    if (!key || !verifyRs256(parts, key) || !claimsAccepted(parts.payload, this.config, this.now())) return undefined;
    return { email: typeof parts.payload.email === 'string' ? parts.payload.email : undefined };
  }

  private async keyFor(kid: string): Promise<JsonWebKey | undefined> {
    if (!this.keys.size || this.now() - this.fetchedAt > KEY_TTL_MS) await this.refresh();
    if (!this.keys.has(kid) && this.now() - this.fetchedAt > UNKNOWN_KID_RETRY_MS) await this.refresh();
    return this.keys.get(kid);
  }

  private refresh(): Promise<void> {
    this.inflight ??= this.load().finally(() => { this.inflight = undefined; });
    return this.inflight;
  }

  private async load(): Promise<void> {
    let body: unknown;
    try { body = await this.fetchJwks(`${this.config.issuer}/cdn-cgi/access/certs`); } catch { this.fetchedAt = this.now(); return; }
    const keys = typeof body === 'object' && body !== null && Array.isArray((body as { keys?: unknown }).keys)
      ? (body as { keys: unknown[] }).keys : [];
    this.keys.clear();
    for (const key of keys) {
      if (typeof key !== 'object' || key === null) continue;
      const jwk = key as JsonWebKey & { kid?: unknown };
      if (typeof jwk.kid === 'string' && jwk.kty === 'RSA') this.keys.set(jwk.kid, jwk);
    }
    this.fetchedAt = this.now();
  }
}
