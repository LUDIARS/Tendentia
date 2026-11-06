import { Hono, type Context } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import { bodyLimit } from 'hono/body-limit';
import type { AccessGate } from './access-gate.ts';
import { type CernereClient } from './cernere-client.ts';
import { PendingLogins } from './pending-login.ts';
import { newSessionId, SESSION_COOKIE, type SessionSigner } from './user-session.ts';
const NONCE_COOKIE = 'td_login_nonce';
const NONCE_PATH = '/api/session';
export interface LoginConfig { cernereUrl: string; cernerePublicUrl: string; clientId: string; clientSecret: string }
export function readLoginConfig(env: NodeJS.ProcessEnv): LoginConfig | null {
  const cernereUrl = env.CERNERE_URL?.trim(), publicRaw = env.TENDENTIA_CERNERE_PUBLIC_URL?.trim();
  const clientId = env.CERNERE_PROJECT_CLIENT_ID?.trim(), clientSecret = env.CERNERE_PROJECT_CLIENT_SECRET?.trim();
  if (!cernereUrl && !publicRaw && !clientId && !clientSecret) return null;
  if (!cernereUrl || !publicRaw || !clientId || !clientSecret) throw new Error('Viewer Composite configuration is incomplete');
  const parsed = new URL(publicRaw), backend = new URL(cernereUrl);
  if (parsed.protocol !== 'https:' || parsed.origin !== publicRaw ||
    backend.origin !== cernereUrl || !(backend.protocol === 'https:' ||
      (backend.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(backend.hostname)))) throw new Error('Composite URL must be a canonical secure origin');
  return { cernereUrl, cernerePublicUrl: parsed.origin, clientId, clientSecret };
}
export interface LoginRouterDeps {
  gate: AccessGate;
  login?: { config: LoginConfig; client: CernereClient; signer: SessionSigner; selfOrigin: string };
}
/** @implements SPEC-TD-SCOPED-SESSION */
export function makeLoginRouter(deps: LoginRouterDeps): Hono {
  const router = new Hono(), pending = new PendingLogins();
  const secure = true;
  const pendingCookie = { path: NONCE_PATH, httpOnly: true, secure, sameSite: 'Strict' as const, maxAge: 300 };
  router.use('/api/session/*', bodyLimit({ maxSize: 16 * 1024 }));
  router.use('/api/session/*', async (context, next) => { context.header('Cache-Control', 'no-store'); await next(); });
  router.get('/api/session', async (context: Context) => {
    context.header('Cache-Control', 'no-store');
    const sessionCookie = getCookie(context, SESSION_COOKIE);
    const user = sessionCookie ? await deps.gate.user(context) : null;
    const session = { loginAvailable: Boolean(deps.login), cernereUrl: deps.login?.config.cernerePublicUrl ?? null,
      user: user ? { displayName: user.displayName } : null };
    const result = () => context.json(session);
    // A presented opaque cookie is an authentication attempt. Never turn an
    // expired, revoked, unknown, or unverifiable owner into an anonymous 200.
    if (sessionCookie && !user) return context.json({ ...session, error: 'ログインをやり直してください' }, 403);
    if (!user) return result();
    try { return await deps.gate.personal(context, user.userId, 'tendentia.personal.session', '', result); }
    catch { return context.json({ error: 'ログインを確認できません' }, 503); }
  });
  router.post('/api/session/*', async (context, next) => {
    const decision = await deps.gate.decide(context, 'session');
    if (!decision.ok) return context.json({ error: decision.reason }, decision.status);
    await next();
  });
  router.post('/api/session/logout', async (context: Context) => {
    pending.cancel(getCookie(context, NONCE_COOKIE));
    deleteCookie(context, NONCE_COOKIE, { path: NONCE_PATH, secure });
    deleteCookie(context, SESSION_COOKIE, { path: '/', secure });
    try { await deps.login?.signer.revoke(getCookie(context, SESSION_COOKIE)); }
    catch { return context.json({ error: 'ログアウトしました。Cernere の失効確認はできませんでした' }, 503); }
    return context.json({ ok: true });
  });
  router.post('/api/session/login/cancel', async (context: Context) => {
    const body = await context.req.json().catch(() => null) as { nonce?: unknown } | null;
    if (typeof body?.nonce !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(body.nonce)) return context.json({ error: '不正な中断要求です' }, 400);
    // Nonce survives an aborted fetch even when the completion cookie response raced it.
    pending.cancelNonce(body.nonce);
    return context.json({ ok: true });
  });
  router.post('/api/session/login/start', async (context: Context) => {
    const login = deps.login;
    if (!login) return context.json({ error: 'この Tendentia ではログインできません' }, 404);
    const body = await context.req.json().catch(() => null) as { challenge?: unknown; state?: unknown } | null;
    if (typeof body?.challenge !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(body.challenge) ||
      typeof body.state !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(body.state)) return context.json({ error: 'PKCE が必要です' }, 400);
    const attempt = pending.start(getCookie(context, NONCE_COOKIE), body.challenge, body.state);
    // Rotation ends the old owner before any new exchange. In-flight operations cannot resurrect it.
    try { await login.signer.revoke(getCookie(context, SESSION_COOKIE)); }
    catch { pending.cancel(attempt.owner); return context.json({ error: 'Cernere の失効確認ができません' }, 503); }
    deleteCookie(context, SESSION_COOKIE, { path: '/', secure });
    setCookie(context, NONCE_COOKIE, attempt.owner, pendingCookie);
    return context.json({ nonce: attempt.nonce, clientId: login.config.clientId });
  });
  router.post('/api/session/login/complete', async (context: Context) => {
    const login = deps.login;
    if (!login) return context.json({ error: 'この Tendentia ではログインできません' }, 404);
    const body = await context.req.json().catch(() => null) as { code?: unknown; nonce?: unknown; state?: unknown; verifier?: unknown } | null;
    const owner = getCookie(context, NONCE_COOKIE);
    if (typeof body?.code !== 'string' || !body.code || body.code.length > 2048 || typeof body.nonce !== 'string' ||
      typeof body.state !== 'string' || typeof body.verifier !== 'string' || !/^[A-Za-z0-9._~-]{43,128}$/.test(body.verifier)) {
      pending.cancel(owner); return context.json({ error: 'ログインの応答が不正です' }, 400);
    }
    let current: () => boolean;
    try { current = pending.take(owner, body.nonce, body.state, body.verifier); }
    catch { return context.json({ error: 'ログインをやり直してください' }, 403); }
    let grant: Awaited<ReturnType<CernereClient['login']>> | undefined;
    let completed = false;
    try {
      const opaque = newSessionId();
      grant = await login.client.login(body.code, body.verifier, opaque);
      if (!current()) throw new Error('Login owner ended');
      login.signer.issue(grant, opaque);
      pending.finish(owner, () => { void login.signer.revoke(opaque).catch(() => { /* Local ownership ended synchronously; remote revocation is best effort. */ }); });
      setCookie(context, SESSION_COOKIE, opaque, { path: '/', httpOnly: true, secure, sameSite: 'Strict',
        maxAge: Math.max(0, Math.floor((Date.parse(grant.expiresAt) - Date.now()) / 1000)) });
      completed = true;
      return context.json({ user: { displayName: grant.user.displayName } });
    } catch {
      if (grant) await login.client.revoke(grant).catch(() => { /* Local owner never issued; remote lifetime stays bounded. */ });
      return context.json({ error: 'ログインを確認できません。もう一度お試しください' }, 503);
    } finally { if (!completed) pending.cancel(owner); deleteCookie(context, NONCE_COOKIE, { path: NONCE_PATH, secure }); }
  });
  return router;
}
