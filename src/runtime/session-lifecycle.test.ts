import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import { cookieFrom, fixture } from './login-fixture.ts';
import { PendingLogins } from './pending-login.ts';
import { newSessionId, SessionSigner } from './user-session.ts';
test('pending ownership is one-use, expired and cancelled attempts cannot bind', () => {
  let now = 0;
  const pending = new PendingLogins(() => now), verifier = 'v'.repeat(43), state = 's'.repeat(43);
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  const first = pending.start(undefined, challenge, state);
  const current = pending.take(first.owner, first.nonce, state, verifier);
  assert.throws(() => pending.take(first.owner, first.nonce, state, verifier));
  pending.cancelNonce(first.nonce); assert.equal(current(), false);
  const expired = pending.start(undefined, challenge, state); now = 300_001;
  assert.throws(() => pending.take(expired.owner, expired.nonce, state, verifier));
});
test('logout during bind prevents issuance and revokes the returned grant', async t => {
  const f = fixture(t), attempt = await f.start(), barrier = f.pause('/api/auth/service/bind');
  const completion = f.at('/api/session/login/complete', { method: 'POST', cookie: attempt.cookie,
    body: JSON.stringify({ ...attempt, code: 'alice' }) });
  await barrier.entered;
  assert.equal((await f.at('/api/session/logout', { method: 'POST', cookie: attempt.cookie, body: '{}' })).status, 200);
  barrier.release(); const response = await completion;
  assert.equal(response.status, 503);
  assert.equal(response.headers.getSetCookie().some(line => line.startsWith('td_session=')), false);
  assert.equal(f.revoked.has('alice'), true);
});
test('simultaneous completion exchanges only once', async t => {
  const f = fixture(t), attempt = await f.start(), barrier = f.pause('/api/auth/service/bind');
  const complete = () => f.at('/api/session/login/complete', { method: 'POST', cookie: attempt.cookie, body: JSON.stringify({ ...attempt, code: 'alice' }) });
  const first = complete(); await barrier.entered;
  assert.equal((await complete()).status, 403);
  barrier.release(); assert.equal((await first).status, 200);
  assert.equal(f.calls.filter(call => call.path.endsWith('/exchange')).length, 1);
});
test('revocation after permit preparation prevents database execution', async t => {
  const f = fixture(t), cookie = await f.login('alice'), barrier = f.pause('/api/auth/service/consume');
  const request = f.at('/api/trend-crawler/click', { method: 'POST', cookie, body: '{"key":"x","genre":"tech","sourceId":"s"}' });
  await barrier.entered;
  await f.signer.revoke(cookie.split('=')[1]); barrier.release();
  assert.equal((await request).status, 503);
  assert.equal((f.db.prepare('SELECT COUNT(*) AS n FROM user_clicks').get() as { n: number }).n, 0);
  assert.equal((f.db.prepare('SELECT COUNT(*) AS n FROM trend_clicks').get() as { n: number }).n, 0);
});

test('a failure after database execution is not an authorization503 or an automatic retry', async t => {
  const f = fixture(t), cookie = await f.login('alice');
  const run = f.signer.run.bind(f.signer);
  t.mock.method(f.signer, 'run', async (...args: Parameters<SessionSigner['run']>) => {
    await run(...args);
    throw new Error('post-execution-failure-sentinel');
  });
  const response = await f.at('/api/trend-crawler/click', { method: 'POST', cookie,
    body: '{"key":"x","genre":"tech","sourceId":"s"}' });
  assert.equal(response.status, 500);
  assert.doesNotMatch(await response.text(), /ログイン|post-execution-failure-sentinel/);
  assert.equal((f.db.prepare('SELECT COUNT(*) AS n FROM user_clicks').get() as { n: number }).n, 1);
  assert.equal(f.calls.filter(call => call.path.endsWith('/consume')).length, 1);
});

test('execution failure preserves the bound identity while surfacing the exact failure once', async t => {
  const f = fixture(t), cookie = await f.login('alice'), opaque = cookie.split('=')[1];
  f.db.exec('CREATE TABLE execution_probe (n INTEGER)');
  const failure = new Error('database outcome unknown');
  await assert.rejects(f.signer.run(opaque, 'alice', 'tendentia.personal.click', '/api/trend-crawler/click', 'important', '{}', () => {
    f.db.prepare('INSERT INTO execution_probe(n) VALUES (1)').run();
    throw failure;
  }), error => error === failure);
  assert.equal(f.signer.read(opaque)?.userId, 'alice');
  assert.equal((f.db.prepare('SELECT COUNT(*) AS n FROM execution_probe').get() as { n: number }).n, 1);
  assert.equal(f.calls.filter(call => call.path.endsWith('/consume')).length, 1);
});
test('a late check cannot revive logout; expiry cannot extend grant lifetime', async t => {
  const f = fixture(t), opaque = newSessionId();
  const grant = await f.client.login('alice', f.verifier, opaque);
  let now = Date.now(); const store = new SessionSigner(f.client, () => now); store.issue(grant, opaque);
  const barrier = f.pause('/api/auth/service/check'), check = store.check(opaque);
  await barrier.entered; await store.revoke(opaque); barrier.release();
  assert.equal(await check, null); assert.equal(store.read(opaque), null);
  const other = newSessionId(), next = await f.client.login('bob', f.verifier, other); store.issue(next, other);
  now = Date.parse(next.expiresAt); assert.equal(store.read(other), null);
  assert.throws(() => store.issue(next, other));
});
test('nonce cleanup also ends a completed login whose fetch response was lost', async t => {
  const f = fixture(t), attempt = await f.start();
  const response = await f.at('/api/session/login/complete', { method: 'POST', cookie: attempt.cookie, body: JSON.stringify({ ...attempt, code: 'alice' }) });
  assert.equal(response.status, 200);
  const opaque = cookieFrom(response, 'td_session').split('=')[1];
  await f.at('/api/session/login/cancel', { method: 'POST', body: JSON.stringify({ nonce: attempt.nonce }) });
  assert.equal(f.signer.read(opaque), null);
});
