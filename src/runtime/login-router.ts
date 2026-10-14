// Cernere でのログイン (/api/session/*)。 手順は spec/feature/personal-login.md#ログインの流れ。
// - GET  /api/session                 → { loginAvailable, cernereUrl, user }
// - POST /api/session/login/start     → { nonce } (nonce は cookie にも入れて complete で照合する)
// - POST /api/session/login/complete  { code, nonce } → Cernere で確かめて td_session を出す
// - POST /api/session/logout          → td_session を消す

import { randomBytes, timingSafeEqual } from 'node:crypto';
import { Hono, type Context } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import type { AccessGate } from './access-gate.ts';
import { type CernereClient, LoginError } from './cernere-client.ts';
import { SESSION_COOKIE, SESSION_TTL_SECONDS, type SessionSigner } from './user-session.ts';

const NONCE_COOKIE = 'td_login_nonce';
const NONCE_PATH = '/api/session';

export interface LoginConfig {
  /** サーバから呼ぶ Cernere (CERNERE_URL)。 */
  cernereUrl: string;
  /** 画面が popup で開く Cernere の公開 URL (TENDENTIA_CERNERE_PUBLIC_URL)。 */
  cernerePublicUrl: string;
}

/** ログインに要る設定。 どれか欠ければ null (ログインを出さない)。 公開 URL の形の誤りは起動時に止める。 */
export function readLoginConfig(env: NodeJS.ProcessEnv): LoginConfig | null {
  const cernereUrl = env.CERNERE_URL?.trim();
  const publicRaw = env.TENDENTIA_CERNERE_PUBLIC_URL?.trim();
  if (!cernereUrl || !publicRaw) return null;
  const parsed = new URL(publicRaw);
  if (parsed.protocol !== 'https:') throw new Error('TENDENTIA_CERNERE_PUBLIC_URL は https で指定してください');
  new URL(cernereUrl);
  return { cernereUrl, cernerePublicUrl: parsed.origin };
}

export interface LoginRouterDeps {
  gate: AccessGate;
  /** ログインを出さないときは無し。 */
  login?: { config: LoginConfig; client: CernereClient; signer: SessionSigner; selfOrigin: string };
}

function sameText(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

export function makeLoginRouter(deps: LoginRouterDeps): Hono {
  const router = new Hono();
  const secure = deps.login ? new URL(deps.login.selfOrigin).protocol === 'https:' : false;

  router.use('/api/session/*', async (context, next) => {
    context.header('Cache-Control', 'no-store');
    await next();
  });

  router.get('/api/session', (context: Context) => {
    const user = deps.gate.user(context);
    return context.json({
      loginAvailable: Boolean(deps.login),
      cernereUrl: deps.login?.config.cernerePublicUrl ?? null,
      user: user ? { displayName: user.displayName } : null,
    });
  });

  router.post('/api/session/*', async (context, next) => {
    const decision = await deps.gate.decide(context, 'session');
    if (!decision.ok) return context.json({ error: decision.reason }, decision.status);
    await next();
  });

  router.post('/api/session/logout', (context: Context) => {
    deleteCookie(context, SESSION_COOKIE, { path: '/', secure });
    return context.json({ ok: true });
  });

  router.post('/api/session/login/start', (context: Context) => {
    if (!deps.login) return context.json({ error: 'この Tendentia ではログインできません' }, 404);
    const nonce = randomBytes(32).toString('hex');
    setCookie(context, NONCE_COOKIE, nonce, { path: NONCE_PATH, httpOnly: true, secure, sameSite: 'Strict', maxAge: 300 });
    return context.json({ nonce });
  });

  router.post('/api/session/login/complete', async (context: Context) => {
    const login = deps.login;
    if (!login) return context.json({ error: 'この Tendentia ではログインできません' }, 404);
    const body = await context.req.json().catch(() => null) as { code?: unknown; nonce?: unknown } | null;
    const cookie = getCookie(context, NONCE_COOKIE);
    deleteCookie(context, NONCE_COOKIE, { path: NONCE_PATH, secure });
    if (typeof body?.nonce !== 'string' || !cookie || body.nonce.length !== 64 || !sameText(body.nonce, cookie)) {
      return context.json({ error: 'ログインをやり直してください' }, 403);
    }
    if (typeof body.code !== 'string' || !body.code || body.code.length > 2_048) return context.json({ error: 'ログインの応答が不正です' }, 400);
    try {
      const identity = await login.client.login(body.code, login.selfOrigin);
      setCookie(context, SESSION_COOKIE, login.signer.issue(identity), {
        path: '/', httpOnly: true, secure, sameSite: 'Lax', maxAge: SESSION_TTL_SECONDS,
      });
      return context.json({ user: { displayName: identity.displayName } });
    } catch (error: unknown) {
      if (error instanceof LoginError) return context.json({ error: error.message }, error.status);
      console.warn('[tendentia] login failed:', error instanceof Error ? error.message : String(error));
      return context.json({ error: 'Cernere に接続できません' }, 503);
    }
  });

  return router;
}
