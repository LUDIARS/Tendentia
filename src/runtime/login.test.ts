import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import { mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import Database from 'better-sqlite3';
import { AccessGate } from './access-gate.ts';
import { makeApp } from './app.ts';
import { CernereClient, type FetchLike } from './cernere-client.ts';
import { ensureSchema } from './db.ts';
import { readLoginConfig } from './login-router.ts';
import { ed25519PublicKey, pae, verifyPasetoV4Public } from './paseto-v4.ts';
import { loadSessionKey, readCookie, SessionSigner } from './user-session.ts';

const SELF = 'https://tendentia.example.com';
const NOW = new Date('2026-10-14T09:00:00.000Z');
const { privateKey, publicKey } = generateKeyPairSync('ed25519');
const rawPublic = Buffer.from((publicKey.export({ format: 'jwk' }) as { x: string }).x, 'base64url').toString('base64');

function paseto(claims: Record<string, unknown>, key = privateKey): string {
  const message = Buffer.from(JSON.stringify(claims));
  const signature = sign(null, pae([Buffer.from('v4.public.'), message, Buffer.alloc(0), Buffer.alloc(0)]), key);
  return `v4.public.${Buffer.concat([message, signature]).toString('base64url')}`;
}

const goodClaims = {
  sub: 'user-1', kind: 'user_for_project', projectKey: 'tendentia', displayName: 'ねこ',
  aud: SELF, exp: new Date(NOW.getTime() + 15 * 60_000).toISOString(),
};

test('PASETO v4.public: 署名・aud・期限が正しいものだけ通す', () => {
  const keys = [ed25519PublicKey(rawPublic)!];
  assert.equal(verifyPasetoV4Public(paseto(goodClaims), keys, { audience: SELF, now: NOW })?.sub, 'user-1');
  assert.equal(verifyPasetoV4Public(paseto({ ...goodClaims, aud: 'https://evil.example.com' }), keys, { audience: SELF, now: NOW }), null);
  assert.equal(verifyPasetoV4Public(paseto({ ...goodClaims, exp: '2026-10-14T08:00:00.000Z' }), keys, { audience: SELF, now: NOW }), null);
  assert.equal(verifyPasetoV4Public(paseto({ ...goodClaims, nbf: '2026-10-14T10:00:00.000Z' }), keys, { audience: SELF, now: NOW }), null);
  const other = generateKeyPairSync('ed25519').privateKey;
  assert.equal(verifyPasetoV4Public(paseto(goodClaims, other), keys, { audience: SELF, now: NOW }), null);
  const token = paseto(goodClaims);
  const tampered = `${token.slice(0, -4)}AAAA`;
  assert.equal(verifyPasetoV4Public(tampered, keys, { audience: SELF, now: NOW }), null);
  assert.equal(verifyPasetoV4Public('v3.public.xxx', keys, { audience: SELF, now: NOW }), null);
  assert.equal(ed25519PublicKey(Buffer.alloc(16).toString('base64')), null);
});

function fakeCernere(project: Record<string, unknown> = { accessToken: paseto({ ...goodClaims, exp: new Date(Date.now() + 600_000).toISOString() }) }): { fetch: FetchLike; calls: string[] } {
  const calls: string[] = [];
  const fetchImpl: FetchLike = async (url, init) => {
    const path = new URL(url).pathname;
    calls.push(`${init?.method ?? 'GET'} ${path}`);
    if (path === '/.well-known/cernere-public-key') return Response.json({ keys: [{ kid: 'k1', public_key: rawPublic }] });
    if (path === '/api/auth/exchange') {
      return JSON.parse(String(init?.body)).code === 'good' ? Response.json({ accessToken: 'user-token' }) : new Response('no', { status: 401 });
    }
    if (path === '/api/auth/project-token') {
      const body = JSON.parse(String(init?.body));
      assert.deepEqual(body, { project_key: 'tendentia', hub_url: SELF });
      assert.equal((init?.headers as Record<string, string>).Authorization, 'Bearer user-token');
      return Response.json(project);
    }
    return new Response('not found', { status: 404 });
  };
  return { fetch: fetchImpl, calls };
}

test('Cernere: authCode から Tendentia 向けの利用者を確かめる。 別プロジェクトの token は断る', async () => {
  const cernere = fakeCernere();
  const client = new CernereClient('http://127.0.0.1:8086', cernere.fetch);
  assert.deepEqual(await client.login('good', SELF), { userId: 'user-1', displayName: 'ねこ' });
  assert.deepEqual(cernere.calls, ['POST /api/auth/exchange', 'POST /api/auth/project-token', 'GET /.well-known/cernere-public-key']);
  await assert.rejects(client.login('bad', SELF), /失効/);

  const wrong = fakeCernere({ accessToken: paseto({ ...goodClaims, projectKey: 'aedilis', exp: new Date(Date.now() + 600_000).toISOString() }) });
  await assert.rejects(new CernereClient('http://127.0.0.1:8086', wrong.fetch).login('good', SELF), /確かめられません/);
});

test('ログイン cookie: 署名と期限が正しいものだけ読み、 鍵は 1 回だけ作る', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tendentia-session-'));
  try {
    const key = loadSessionKey(dir);
    assert.deepEqual(loadSessionKey(dir), key);
    if (process.platform !== 'win32') assert.equal(statSync(join(dir, 'session.key')).mode & 0o777, 0o600);
    let now = NOW.getTime();
    const signer = new SessionSigner(key, () => now);
    const value = signer.issue({ userId: 'user-1', displayName: 'ねこ' });
    assert.deepEqual(signer.read(value), { userId: 'user-1', displayName: 'ねこ' });
    assert.equal(signer.read(`${value}x`), null);
    assert.equal(new SessionSigner(Buffer.alloc(32, 1), () => now).read(value), null);
    now += 31 * 24 * 60 * 60 * 1000;
    assert.equal(signer.read(value), null);
    assert.equal(readCookie('a=1; td_session=abc%3D; b=2', 'td_session'), 'abc=');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('ログインの設定: 両方揃ったときだけ出し、 公開 URL は https', () => {
  assert.equal(readLoginConfig({}), null);
  assert.equal(readLoginConfig({ CERNERE_URL: 'http://127.0.0.1:8086' }), null);
  assert.deepEqual(readLoginConfig({ CERNERE_URL: 'http://127.0.0.1:8086', TENDENTIA_CERNERE_PUBLIC_URL: 'https://cr.example.com/' }),
    { cernereUrl: 'http://127.0.0.1:8086', cernerePublicUrl: 'https://cr.example.com' });
  assert.throws(() => readLoginConfig({ CERNERE_URL: 'http://x', TENDENTIA_CERNERE_PUBLIC_URL: 'http://cr.example.com' }), /https/);
});

function viewerApp() {
  const db = new Database(':memory:');
  ensureSchema(db);
  const signer = new SessionSigner(Buffer.alloc(32, 7));
  const entrance = { origin: SELF, hosts: ['tendentia.example.com'] };
  const gate = new AccessGate({ entrance, readOnly: true, session: signer, sameMachine: () => false });
  const cernere = fakeCernere();
  const login = {
    config: { cernereUrl: 'http://127.0.0.1:8086', cernerePublicUrl: 'https://cr.example.com' },
    client: new CernereClient('http://127.0.0.1:8086', cernere.fetch), signer, selfOrigin: SELF,
  };
  const app = makeApp({ db, webDir: 'Z:/no-such-dir', version: '0.1.0', gate, login });
  const at = (path: string, init: RequestInit & { cookie?: string; origin?: string | null } = {}) => {
    const headers: Record<string, string> = { host: 'tendentia.example.com', 'content-type': 'application/json' };
    if (init.cookie) headers.cookie = init.cookie;
    if (init.origin !== null) headers.origin = init.origin ?? SELF;
    return app.request(`${SELF}${path}`, { ...init, headers });
  };
  return { db, at, signer };
}

/** Set-Cookie から name=value を取り出す。 */
function cookieFrom(response: Response, name: string): string {
  const header = response.headers.getSetCookie().find((line) => line.startsWith(`${name}=`));
  assert.ok(header, `${name} が出ていません`);
  return header.split(';')[0];
}

test('viewer のログイン: nonce を照合して td_session を出し、 ログイン前後で書けるものが変わる', async () => {
  const { at } = viewerApp();
  assert.deepEqual(await (await at('/api/session')).json(), { loginAvailable: true, cernereUrl: 'https://cr.example.com', user: null });
  // ログイン前: 好みの記録もサイトの設定も書けない。
  assert.equal((await at('/api/trend-crawler/click', { method: 'POST', body: JSON.stringify({ key: 'a', genre: 'tech', sourceId: 's' }) })).status, 403);

  const start = await at('/api/session/login/start', { method: 'POST' });
  const { nonce } = await start.json() as { nonce: string };
  const nonceCookie = cookieFrom(start, 'td_login_nonce');
  // nonce が違う / 別サイトからの complete は断る。
  assert.equal((await at('/api/session/login/complete', { method: 'POST', cookie: nonceCookie, body: JSON.stringify({ code: 'good', nonce: 'f'.repeat(64) }) })).status, 403);
  assert.equal((await at('/api/session/login/complete', { method: 'POST', cookie: nonceCookie, origin: 'https://evil.example.com', body: JSON.stringify({ code: 'good', nonce }) })).status, 403);
  const complete = await at('/api/session/login/complete', { method: 'POST', cookie: nonceCookie, body: JSON.stringify({ code: 'good', nonce }) });
  assert.equal(complete.status, 200);
  assert.deepEqual(await complete.json(), { user: { displayName: 'ねこ' } });
  const session = cookieFrom(complete, 'td_session');

  assert.deepEqual(await (await at('/api/session', { cookie: session })).json(), { loginAvailable: true, cernereUrl: 'https://cr.example.com', user: { displayName: 'ねこ' } });
  assert.deepEqual(await (await at('/api/trend-crawler/access', { cookie: session })).json(), { canEdit: false, canPersonalize: true, user: { displayName: 'ねこ' } });
  assert.equal((await at('/api/trend-crawler/click', { method: 'POST', cookie: session, body: JSON.stringify({ key: 'a', genre: 'tech', sourceId: 's', title: 'A' }) })).status, 200);
  // ログインしていても別サイトからの書き込み・Origin の無い書き込み・サイトの設定は断る。
  assert.equal((await at('/api/trend-crawler/click', { method: 'POST', cookie: session, origin: 'https://evil.example.com', body: '{}' })).status, 403);
  assert.equal((await at('/api/trend-crawler/click', { method: 'POST', cookie: session, origin: null, body: '{}' })).status, 403);
  assert.equal((await at('/api/trend-crawler/refresh', { method: 'POST', cookie: session })).status, 403);
  assert.equal((await at('/api/trend-crawler/config', { method: 'PUT', cookie: session, body: '{}' })).status, 403);

  assert.equal((await at('/api/session/logout', { method: 'POST', cookie: session })).status, 200);
});

test('ログインした人のマップ・興味・傾向はその人だけのもので、 サイトの既定は変わらない', async () => {
  const { db, at, signer } = viewerApp();
  db.prepare("INSERT INTO app_settings (key, value) VALUES ('trend_crawler.interest', '{\"genreWeights\":{\"tech\":2},\"keywords\":[]}')").run();
  const alice = `td_session=${signer.issue({ userId: 'alice', displayName: 'A' })}`;
  const bob = `td_session=${signer.issue({ userId: 'bob', displayName: 'B' })}`;

  // 未設定なら本社の既定を返す。
  assert.deepEqual(await (await at('/api/trend-crawler/interest', { cookie: alice })).json(), { genreWeights: { tech: 2 }, keywords: [] });
  const put = await at('/api/trend-crawler/interest', { method: 'PUT', cookie: alice, body: JSON.stringify({ genreWeights: { music: 3 }, keywords: ['ライブ'] }) });
  assert.equal(put.status, 200);
  assert.deepEqual(await (await at('/api/trend-crawler/interest', { cookie: alice })).json(), { genreWeights: { music: 3 }, keywords: ['ライブ'] });
  assert.deepEqual(await (await at('/api/trend-crawler/interest', { cookie: bob })).json(), { genreWeights: { tech: 2 }, keywords: [] });
  assert.deepEqual(await (await at('/api/trend-crawler/interest')).json(), { genreWeights: { tech: 2 }, keywords: [] });

  for (const title of ['曲A', '曲A', '曲B']) {
    await at('/api/trend-crawler/click', { method: 'POST', cookie: alice, body: JSON.stringify({ key: title, genre: 'music', sourceId: 'apple', title }) });
  }
  const map = await (await at('/api/trend-crawler/map', { cookie: alice })).json() as { map: { prefs: { genreWeights: object } } };
  assert.deepEqual(map.map.prefs.genreWeights, { music: 3 });

  const tendency = await (await at('/api/trend-crawler/tendency', { cookie: alice })).json() as { tendency: { total: number; genres: { genre: string; count: number }[]; topics: { title: string; count: number }[] } };
  assert.equal(tendency.tendency.total, 3);
  assert.deepEqual(tendency.tendency.genres.map((g) => [g.genre, g.count]), [['music', 3]]);
  assert.deepEqual(tendency.tendency.topics.map((t) => [t.title, t.count]), [['曲A', 2], ['曲B', 1]]);
  const bobs = await (await at('/api/trend-crawler/tendency', { cookie: bob })).json() as { tendency: { total: number } };
  assert.equal(bobs.tendency.total, 0);
  assert.equal((await at('/api/trend-crawler/tendency')).status, 401);
  // サイト全体の開いた記録には入らない。
  assert.equal((db.prepare('SELECT COUNT(*) AS n FROM trend_clicks').get() as { n: number }).n, 0);
});

test('collector (本社) はログインを出さず、 同じ端末からはサイトの既定を今まで通り変えられる', async () => {
  const db = new Database(':memory:');
  ensureSchema(db);
  const gate = new AccessGate({ entrance: { origin: null, hosts: [] }, sameMachine: () => true });
  const app = makeApp({ db, webDir: 'Z:/no-such-dir', version: '0.1.0', gate });
  assert.deepEqual(await (await app.request('http://127.0.0.1/api/session')).json(), { loginAvailable: false, cernereUrl: null, user: null });
  const click = await app.request('http://127.0.0.1/api/trend-crawler/click', { method: 'POST', body: JSON.stringify({ key: 'a', genre: 'tech', sourceId: 's' }) });
  assert.equal(click.status, 200);
  assert.equal((db.prepare('SELECT COUNT(*) AS n FROM trend_clicks').get() as { n: number }).n, 1);
  assert.equal((await app.request('http://127.0.0.1/api/session/login/start', { method: 'POST' })).status, 404);
});
