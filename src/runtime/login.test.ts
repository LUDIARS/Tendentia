import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import Database from 'better-sqlite3';
import { fixture, SELF } from './login-fixture.ts';
import { readLoginConfig } from './login-router.ts';
import { newSessionId } from './user-session.ts';
import { AccessGate } from './access-gate.ts';
import { makeApp } from './app.ts';
import { ensureSchema } from './db.ts';
test('project credential + verifier exchange is one-shot, no global/project-token fallback', async t => {
  const f = fixture(t);
  for (const code of ['wrong-project', 'kiosk']) await assert.rejects(f.client.login(code, f.verifier, newSessionId()));
  await assert.rejects(f.client.login('alice', 'x'.repeat(43), newSessionId()));
  const grant = await f.client.login('alice', f.verifier, newSessionId());
  assert.equal(grant.user.id, 'alice');
  await assert.rejects(f.client.login('alice', f.verifier, newSessionId()));
  assert.equal(f.calls.some(c => c.path.includes('project-token') || c.path.includes('public-key')), false);
});
test('state/verifier/nonce mismatch consumes pending login before any exchange', async t => {
  const f = fixture(t);
  for (const wrong of [{ state: 'x'.repeat(43) }, { verifier: 'x'.repeat(43) }, { nonce: 'bad' }]) {
    const attempt = await f.start();
    const complete = (body: unknown) => f.at('/api/session/login/complete', { method: 'POST', cookie: attempt.cookie, body: JSON.stringify(body) });
    assert.equal((await complete({ ...attempt, code: 'alice', ...wrong })).status, 403);
    assert.equal((await complete({ ...attempt, code: 'alice' })).status, 403);
  }
  assert.equal(f.calls.length, 0);
});
test('opaque cookie, Origin guard and logout reject replay', async t => {
  const f = fixture(t), cookie = await f.login('alice');
  assert.match(cookie, /^td_session=[A-Za-z0-9_-]{43}$/);
  for (const origin of [null, 'https://evil.example']) assert.equal((await f.at('/api/session/logout', { method: 'POST', cookie, origin, body: '{}' })).status, 403);
  assert.equal((await f.at('/api/trend-crawler/config', { method: 'PUT', cookie, body: '{}' })).status, 403);
  assert.equal((await f.at('/api/session/logout', { method: 'POST', cookie, body: '{}' })).status, 200);
  assert.equal((await f.at('/api/trend-crawler/tendency', { cookie })).status, 403);
  assert.equal(f.signer.read(cookie.split('=')[1]), null);
});
test('DB reads and writes use current owner and exact request digest', async t => {
  const f = fixture(t), alice = await f.login('alice'), bob = await f.login('bob');
  const body = '{ "genreWeights": {"music":3}, "keywords": ["ライブ"] }';
  assert.equal((await f.at('/api/trend-crawler/interest', { method: 'PUT', cookie: alice, body })).status, 200);
  const read = async (cookie: string) => (await f.at('/api/trend-crawler/interest', { cookie })).json();
  assert.deepEqual(await read(alice), { genreWeights: { music: 3 }, keywords: ['ライブ'] });
  assert.notDeepEqual(await read(bob), await read(alice));
  assert.equal((await f.at('/api/trend-crawler/tendency')).status, 401);
  const permit = f.calls.find(c => c.path.endsWith('/authorize') && c.body.action === 'tendentia.personal.interest.write');
  assert.ok(permit); assert.equal(permit.body.resource, 'self:/api/trend-crawler/interest');
  assert.equal(permit.body.contentDigest, createHash('sha256').update(body).digest('base64url'));
  assert.equal((f.db.prepare('SELECT COUNT(*) AS n FROM trend_clicks').get() as { n: number }).n, 0);
});
test('unknown authority invalidates local session without cached fallback', async t => {
  const f = fixture(t), cookie = await f.login('alice'); f.fail('/api/auth/service/check');
  const session = await f.at('/api/session', { cookie });
  assert.equal(session.status, 403);
  assert.deepEqual(await session.json(), { loginAvailable: true, cernereUrl: 'https://cr.example.com', user: null,
    error: 'ログインをやり直してください' });
  assert.equal(f.signer.read(cookie.split('=')[1]), null);
  assert.equal((await f.at('/api/trend-crawler/interest', { cookie })).status, 403);
  assert.equal((await f.at('/api/trend-crawler/click', { method: 'POST', cookie, body: '{"key":"x","genre":"tech","sourceId":"s"}' })).status, 403);
  assert.equal((await f.at('/api/trend-crawler/overview', { cookie })).status, 200);
});
test('unknown opaque cookie is rejected without authority traffic', async t => {
  const f = fixture(t);
  const response = await f.at('/api/session', { cookie: `td_session=${'x'.repeat(43)}` });
  assert.equal(response.status, 403);
  assert.equal(f.calls.length, 0);
});
test('collector remains anonymous with local defaults', async t => {
  const db = new Database(':memory:'); ensureSchema(db); t.after(() => db.close());
  const gate = new AccessGate({ entrance: { origin: null, hosts: [] }, sameMachine: () => true });
  const app = makeApp({ db, gate, webDir: 'missing', version: 'test' });
  assert.equal((await (await app.request(`${SELF}/api/session`)).json() as { loginAvailable: boolean }).loginAvailable, false);
  assert.equal((await app.request(`${SELF}/api/trend-crawler/click`, { method: 'POST', body: '{"key":"x","genre":"tech","sourceId":"s"}' })).status, 200);
});
test('partial credentials fail fast', () => {
  assert.equal(readLoginConfig({}), null);
  assert.throws(() => readLoginConfig({ CERNERE_URL: 'https://cr.example.com' }), /incomplete/);
  assert.throws(() => readLoginConfig({ TENDENTIA_CERNERE_PUBLIC_URL: 'https://cr.example.com' }), /incomplete/);
});
test('expired, revoked and changed service identity are rejected on the next personal read', async t => {
  const f = fixture(t);
  for (const [code, mutate] of [
    ['expired', () => { f.grants.get('expired')!.expiresAt = new Date(Date.now() - 1).toISOString(); }],
    ['revoked', () => { f.revoked.add('revoked'); }],
    ['changed', () => { f.grants.get('changed')!.projectKey = 'another-project'; }],
  ] as const) {
    const cookie = await f.login(code); mutate();
    assert.equal((await f.at('/api/trend-crawler/tendency', { cookie })).status, 403);
  }
});
