// Test-only transport; the actual SDK is exercised, without a live service.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import type { TestContext } from 'node:test';
import Database from 'better-sqlite3';
import { makeApp } from './app.ts';
import { AccessGate } from './access-gate.ts';
import { CernereClient } from './cernere-client.ts';
import { ensureSchema } from './db.ts';
import { SessionSigner } from './user-session.ts';
export const SELF = 'https://td.example.com';
export const config = { cernereUrl: 'https://cr.example.com', cernerePublicUrl: 'https://cr.example.com', clientId: 'td-client', clientSecret: 'test-only-secret' };
export function fixture(t: TestContext) {
  const calls: { path: string; body: Record<string, unknown> }[] = [];
  const codes = new Set<string>(), revoked = new Set<string>();
  const grants = new Map<string, { user: { id: string; displayName: string; role: string; email: null }; expiresAt: string; projectKey: string; binding?: string }>();
  let fail: string | undefined;
  let barrier: { path: string; entered: () => void; wait: Promise<void> } | undefined;
  const verifier = 'v'.repeat(43);
  t.mock.method(globalThis, 'fetch', async (input: string | URL | Request, init?: RequestInit) => {
    const path = new URL(String(input)).pathname, body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    calls.push({ path, body });
    if (barrier?.path === path) { const owned = barrier; barrier = undefined; owned.entered(); await owned.wait; }
    if (path === fail) return new Response(null, { status: 503 });
    if (path === '/api/auth/login') {
      assert.deepEqual(body, { grant_type: 'project_credentials', client_id: config.clientId, client_secret: config.clientSecret });
      return Response.json({ accessToken: 'project-credential', tokenType: 'project', expiresIn: 300, project: { key: 'tendentia' } });
    }
    assert.equal(new Headers(init?.headers).get('authorization'), 'Bearer project-credential');
    if (path === '/api/auth/exchange') {
      const code = String(body.code);
      if (body.code_verifier !== verifier || codes.has(code) || code === 'wrong-project' || code === 'kiosk') return new Response(null, { status: 401 });
      codes.add(code);
      const user = { id: code, displayName: code, email: null, role: 'user' };
      grants.set(code, { user, projectKey: 'tendentia', expiresAt: new Date(Date.now() + 600_000).toISOString() });
      return Response.json({ projectToken: code, user });
    }
    const grant = grants.get(String(body.projectToken));
    if (!grant || revoked.has(String(body.projectToken))) return new Response(null, { status: 401 });
    if (path.endsWith('/bind')) {
      if (grant.binding) return new Response(null, { status: 401 });
      grant.binding = String(body.sessionBinding);
    } else if (body.sessionBinding !== grant.binding) return new Response(null, { status: 401 });
    if (path.endsWith('/revoke')) { revoked.add(String(body.projectToken)); return Response.json({ revoked: true }); }
    const risk = body.contentDigest === createHash('sha256').update('').digest('base64url') ? 'sensitive_read' : 'important';
    if (path.endsWith('/authorize')) return Response.json({ permit: 'p'.repeat(43), expiresIn: 30, risk });
    if (path.endsWith('/consume')) return Response.json({ allowed: true, requestId: body.requestId, risk });
    return Response.json(grant);
  });
  const client = new CernereClient({ ...config, projectKey: 'tendentia' }), signer = new SessionSigner(client);
  const db = new Database(':memory:'); ensureSchema(db);
  t.after(() => { db.close(); client.dispose(); });
  const gate = new AccessGate({ entrance: { origin: SELF, hosts: ['td.example.com'] }, readOnly: true, session: signer, sameMachine: () => false });
  const app = makeApp({ db, gate, login: { config, client, signer, selfOrigin: SELF }, webDir: 'missing', version: 'test' });
  const at = (path: string, init: RequestInit & { cookie?: string; origin?: string | null } = {}) => {
    const headers = new Headers(init.headers); headers.set('host', 'td.example.com'); headers.set('content-type', 'application/json');
    if (init.cookie) headers.set('cookie', init.cookie);
    if (init.origin !== null) headers.set('origin', init.origin ?? SELF);
    return app.request(`${SELF}${path}`, { ...init, headers });
  };
  const start = async (state = 's'.repeat(43)) => {
    const response = await at('/api/session/login/start', { method: 'POST', body: JSON.stringify({ state, challenge: createHash('sha256').update(verifier).digest('base64url') }) });
    assert.equal(response.status, 200);
    const { nonce } = await response.json() as { nonce: string };
    return { state, nonce, cookie: cookieFrom(response, 'td_login_nonce'), verifier };
  };
  const login = async (code: string) => {
    const attempt = await start();
    const response = await at('/api/session/login/complete', { method: 'POST', cookie: attempt.cookie, body: JSON.stringify({ ...attempt, code }) });
    assert.equal(response.status, 200); return cookieFrom(response, 'td_session');
  };
  const pause = (path: string) => {
    let enter!: () => void, release!: () => void;
    const entered = new Promise<void>(resolve => { enter = resolve; });
    const wait = new Promise<void>(resolve => { release = resolve; });
    barrier = { path, entered: enter, wait };
    return { entered, release };
  };
  return { at, start, login, db, client, signer, calls, grants, revoked, verifier, pause, fail: (path: string) => { fail = path; } };
}
export function cookieFrom(response: Response, name: string): string {
  const header = response.headers.getSetCookie().find(line => line.startsWith(`${name}=`));
  assert.ok(header); return header.split(';')[0];
}
