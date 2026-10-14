// だれの要求を通すかを決める。
// - 同じ端末から (127.0.0.1 / この機械の名前・アドレス) の要求は今まで通り通し、 変更もできる。
// - viewer (AWS の閲覧専用) は、 同じ端末も含めて誰からの変更も受け付けない (readOnly)。
// - 公開 Host (TENDENTIA_SELF_URL と LUDIARS_ALLOWED_HOSTS) への要求:
//   - Cloudflare Access を設定していない (全公開。 2026-10-14 neco「秘匿物ないので全公開で良い」) ときは、
//     閲覧 (GET / HEAD) だけ誰でも通す。 設定の変更・巡回・興味・開いた記録などの書き込みは断る。
//   - Cloudflare Access を設定したときは JWT が正しい要求だけを通し、 ログイン済みなら変更もできる。
//   - 書き込みで Origin が付いていれば、 公開 URL の Origin と一致しなければ断る (別サイトからの書き込みを防ぐ)。
// - 本人の好み (scope personal) とログイン (scope session) の書き込みは、 公開 URL と同じ Origin からなら通す。
//   personal はさらに Cernere でログイン済み (td_session) であること (spec/feature/personal-login.md)。
// - それ以外は 403。

import type { Context } from 'hono';
import type { CfAccessVerifier } from './cf-access.ts';
import { isSameMachineRequest } from './local-request.ts';
import { readCookie, SESSION_COOKIE, type SessionSigner, type SessionUser } from './user-session.ts';

export interface PublicEntrance {
  /** 公開 URL の Origin (https://tendentia.example.com)。 */
  origin: string | null;
  /** 公開として受け付ける Host (小文字。 先頭ドットはそのドメインと配下)。 */
  hosts: string[];
}

/** 何を書き換える要求か。 site = 設定・巡回、 personal = 本人の好み (興味・開いた記録)、 session = ログイン・ログアウト。 */
export type AccessScope = 'site' | 'personal' | 'session';

export type AccessDecision =
  | { ok: true; via: 'local' | 'public'; canEdit: boolean; email?: string; user?: SessionUser }
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
  try { url = new URL(value.trim()); } catch { throw new Error('TENDENTIA_SELF_URL は https の Origin で指定してください'); }
  if (url.protocol !== 'https:' || url.origin !== value.trim()) throw new Error('TENDENTIA_SELF_URL は https の Origin で指定してください');
  return url.origin;
}

export function publicEntrance(env: NodeJS.ProcessEnv): PublicEntrance {
  // 自分の公開 URL。 TENDENTIA_PUBLIC_URL は「見せる側の公開 URL」として catalog の provides で全サービスに配るので、
  // 名前がぶつからないよう自分用は TENDENTIA_SELF_URL で受け取る。
  const origin = parsePublicOrigin(env.TENDENTIA_SELF_URL);
  const hosts = parseAllowedHosts(env.LUDIARS_ALLOWED_HOSTS);
  if (origin) hosts.push(new URL(origin).host);
  return { origin, hosts };
}

const READ_METHODS = new Set(['GET', 'HEAD']);

export interface AccessGateDeps {
  entrance: PublicEntrance;
  verifier?: CfAccessVerifier;
  sameMachine?: (context: Context) => boolean;
  /** true なら誰からもサイトの変更 (設定・巡回) を受け付けない (viewer)。 本人の好みの記録はログインすれば書ける。 */
  readOnly?: boolean;
  /** ログイン cookie の読み手。 無ければ誰もログインしていない扱い。 */
  session?: SessionSigner;
}

export class AccessGate {
  private readonly deps: AccessGateDeps;

  constructor(deps: AccessGateDeps) {
    this.deps = deps;
  }

  /** ログイン cookie の利用者 (署名と期限が正しいときだけ)。 */
  user(context: Context): SessionUser | null {
    return this.deps.session?.read(readCookie(context.req.header('cookie'), SESSION_COOKIE)) ?? null;
  }

  async decide(context: Context, scope: AccessScope = 'site'): Promise<AccessDecision> {
    const user = this.user(context);
    const withUser = (decision: AccessDecision): AccessDecision => (decision.ok && user ? { ...decision, user } : decision);
    const reading = READ_METHODS.has(context.req.method.toUpperCase());
    if (!reading && scope !== 'site') return withUser(this.decidePersonalWrite(context, scope, user));
    const decision = await this.decideAccess(context);
    if (!this.deps.readOnly || !decision.ok) return withUser(decision);
    if (!reading) return { ok: false, status: 403, reason: 'この Tendentia は閲覧専用です (変更は本社の Tendentia で)' };
    return withUser({ ...decision, canEdit: false });
  }

  /** 本人の好みとログインの書き込み。 同じ端末 (viewer を除く) か、 公開 URL からの同じサイトの要求だけを通す。 */
  private decidePersonalWrite(context: Context, scope: AccessScope, user: SessionUser | null): AccessDecision {
    const sameMachine = this.deps.sameMachine ?? isSameMachineRequest;
    if (sameMachine(context)) {
      if (!this.deps.readOnly) return { ok: true, via: 'local', canEdit: true };
      if (scope === 'session' || user) return { ok: true, via: 'local', canEdit: false };
      return { ok: false, status: 403, reason: 'ログインすると自分の好みを記録できます' };
    }
    if (!matchesHost(context.req.header('host'), this.deps.entrance.hosts)) return { ok: false, status: 403, reason: 'この端末か公開 URL からだけ開けます' };
    // cookie 付きの書き込みなので、 別サイトから送らせる要求 (CSRF) を Origin で断る。 Origin の無い書き込みも断る。
    if (!this.deps.entrance.origin || context.req.header('origin') !== this.deps.entrance.origin) {
      return { ok: false, status: 403, reason: '別のサイトからの要求は受け付けません' };
    }
    if (scope === 'personal' && !user) return { ok: false, status: 403, reason: 'ログインすると自分の好みを記録できます' };
    return { ok: true, via: 'public', canEdit: false };
  }

  private async decideAccess(context: Context): Promise<AccessDecision> {
    const sameMachine = this.deps.sameMachine ?? isSameMachineRequest;
    if (sameMachine(context)) return { ok: true, via: 'local', canEdit: true };
    const host = context.req.header('host');
    if (!matchesHost(host, this.deps.entrance.hosts)) return { ok: false, status: 403, reason: 'この端末か公開 URL からだけ開けます' };
    const reading = READ_METHODS.has(context.req.method.toUpperCase());
    if (!this.deps.verifier) {
      return reading
        ? { ok: true, via: 'public', canEdit: false }
        : { ok: false, status: 403, reason: '公開 URL からは閲覧だけできます (変更はこの端末から)' };
    }
    const identity = await this.deps.verifier.verify(context.req.header('cf-access-jwt-assertion'));
    if (!identity) return { ok: false, status: 403, reason: 'Cloudflare Access のログインが必要です' };
    const origin = context.req.header('origin');
    if (!reading && origin && origin !== this.deps.entrance.origin) return { ok: false, status: 403, reason: '別のサイトからの要求は受け付けません' };
    return { ok: true, via: 'public', canEdit: true, email: identity.email };
  }
}
