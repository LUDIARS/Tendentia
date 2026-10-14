// だれの要求を通すかを決める。
// - 同じ端末から (127.0.0.1 / この機械の名前・アドレス) の要求は今まで通り通す。
// - 公開 Host (TENDENTIA_PUBLIC_URL と LUDIARS_ALLOWED_HOSTS) への要求は、 Cloudflare Access の JWT が正しいときだけ通す。
//   公開の設定 (team / AUD) が無ければ 503 で断る (認証を外して公開することはない)。
//   Origin が付いていれば、 公開 URL の Origin と一致しなければ断る (別サイトからの書き込みを防ぐ)。
// - それ以外は 403。

import type { Context } from 'hono';
import type { CfAccessVerifier } from './cf-access.js';
import { isSameMachineRequest } from './local-request.js';

export interface PublicEntrance {
  /** 公開 URL の Origin (https://tendentia.example.com)。 */
  origin: string | null;
  /** 公開として受け付ける Host (小文字。 先頭ドットはそのドメインと配下)。 */
  hosts: string[];
}

export type AccessDecision =
  | { ok: true; via: 'local' | 'public'; email?: string }
  | { ok: false; status: 403 | 503; reason: string };

/** 先頭ドットはドメインとその配下に一致 (Excubitor / Vite の書き方)。 */
export function matchesHost(host: string | undefined, allowed: readonly string[]): boolean {
  if (!host || /[\s,/@\\?#%]/.test(host)) return false;
  let hostname: string;
  try { hostname = new URL(`http://${host}`).hostname; } catch { return false; }
  const authority = host.toLowerCase();
  return allowed.some((entry) => entry.startsWith('.')
    ? hostname === entry.slice(1) || hostname.endsWith(entry)
    : authority === entry || (!entry.includes(':') && hostname === entry));
}

export function parseAllowedHosts(value: string | undefined): string[] {
  return (value ?? '').split(',').map((entry) => entry.trim().toLowerCase()).filter(Boolean).map((entry) => {
    const hostname = entry.startsWith('.') ? entry.slice(1) : entry;
    if (hostname.length > 253 || !hostname.split('.').every((label) => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label))) {
      throw new Error('LUDIARS_ALLOWED_HOSTS に不正なホスト名があります');
    }
    return entry;
  });
}

/** 公開 URL は https の Origin そのもの (パス無し) だけを受け付ける。 */
export function parsePublicOrigin(value: string | undefined): string | null {
  if (!value?.trim()) return null;
  let url: URL;
  try { url = new URL(value.trim()); } catch { throw new Error('TENDENTIA_PUBLIC_URL は https の Origin で指定してください'); }
  if (url.protocol !== 'https:' || url.origin !== value.trim()) throw new Error('TENDENTIA_PUBLIC_URL は https の Origin で指定してください');
  return url.origin;
}

export function publicEntrance(env: NodeJS.ProcessEnv): PublicEntrance {
  const origin = parsePublicOrigin(env.TENDENTIA_PUBLIC_URL);
  const hosts = parseAllowedHosts(env.LUDIARS_ALLOWED_HOSTS);
  if (origin) hosts.push(new URL(origin).host);
  return { origin, hosts };
}

export interface AccessGateDeps {
  entrance: PublicEntrance;
  verifier?: CfAccessVerifier;
  sameMachine?: (context: Context) => boolean;
}

export class AccessGate {
  constructor(private readonly deps: AccessGateDeps) {}

  async decide(context: Context): Promise<AccessDecision> {
    const sameMachine = this.deps.sameMachine ?? isSameMachineRequest;
    if (sameMachine(context)) return { ok: true, via: 'local' };
    const host = context.req.header('host');
    if (!matchesHost(host, this.deps.entrance.hosts)) return { ok: false, status: 403, reason: 'この端末か公開 URL からだけ開けます' };
    if (!this.deps.verifier) return { ok: false, status: 503, reason: '公開の入口 (Cloudflare Access) が未設定です' };
    const identity = await this.deps.verifier.verify(context.req.header('cf-access-jwt-assertion'));
    if (!identity) return { ok: false, status: 403, reason: 'Cloudflare Access のログインが必要です' };
    const origin = context.req.header('origin');
    if (origin && origin !== this.deps.entrance.origin) return { ok: false, status: 403, reason: '別のサイトからの要求は受け付けません' };
    return { ok: true, via: 'public', email: identity.email };
  }
}
