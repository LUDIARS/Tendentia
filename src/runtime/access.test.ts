import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import { test } from 'node:test';
import Database from 'better-sqlite3';
import type { Context } from 'hono';
import { AccessGate, matchesHost, parseAllowedHosts, parsePublicOrigin, publicEntrance } from './access-gate.ts';
import { makeApp } from './app.ts';
import { CfAccessVerifier, readCfAccessConfig, type CfAccessConfig } from './cf-access.ts';
import { ensureSchema } from './db.ts';

const AUD = 'a'.repeat(64);
const CONFIG: CfAccessConfig = { issuer: 'https://team.cloudflareaccess.com', audience: AUD };
const NOW = Date.UTC(2026, 9, 14, 9, 0, 0);

const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const jwk = { ...publicKey.export({ format: 'jwk' }), kid: 'k1', kty: 'RSA' };

function b64(value: object): string {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

function token(payload: Record<string, unknown>, kid = 'k1'): string {
  const head = b64({ alg: 'RS256', kid });
  const body = b64(payload);
  const signature = sign('RSA-SHA256', Buffer.from(`${head}.${body}`), privateKey).toString('base64url');
  return `${head}.${body}.${signature}`;
}

const valid = { iss: CONFIG.issuer, aud: [AUD], exp: NOW / 1000 + 600, email: 'neco@example.com' };

function verifier(): CfAccessVerifier {
  return new CfAccessVerifier(CONFIG, async () => ({ keys: [jwk] }), () => NOW);
}

test('Cloudflare Access の JWT: 正しい署名・iss・aud・期限のものだけ通す', async () => {
  const v = verifier();
  assert.deepEqual(await v.verify(token(valid)), { email: 'neco@example.com' });
  assert.equal(await v.verify(token({ ...valid, aud: ['b'.repeat(64)] })), undefined);
  assert.equal(await v.verify(token({ ...valid, iss: 'https://evil.cloudflareaccess.com' })), undefined);
  assert.equal(await v.verify(token({ ...valid, exp: NOW / 1000 - 1 })), undefined);
  assert.equal(await v.verify(token(valid, 'unknown')), undefined);
  assert.equal(await v.verify(`${token(valid).slice(0, -4)}AAAA`), undefined);
  assert.equal(await v.verify(undefined), undefined);
});

test('Access の設定は Excubitor の runtime-config か明示の 2 つ組から読み、 片方だけは起動時に止める', () => {
  assert.equal(readCfAccessConfig({}), undefined);
  const fromEx = readCfAccessConfig({ EXCUBITOR_SERVICE_CONFIG_JSON: JSON.stringify({ cloudflareAccess: { teamDomain: 'Team.cloudflareaccess.com', audience: AUD.toUpperCase() } }) });
  assert.deepEqual(fromEx, CONFIG);
  assert.deepEqual(readCfAccessConfig({ TENDENTIA_CF_ACCESS_TEAM_DOMAIN: 'https://team.cloudflareaccess.com', TENDENTIA_CF_ACCESS_AUD: AUD }), CONFIG);
  assert.throws(() => readCfAccessConfig({ TENDENTIA_CF_ACCESS_AUD: AUD }), /2 つそろえて/);
  assert.throws(() => readCfAccessConfig({ TENDENTIA_CF_ACCESS_TEAM_DOMAIN: 'evil.example.com', TENDENTIA_CF_ACCESS_AUD: AUD }), /team domain/);
  assert.equal(readCfAccessConfig({ EXCUBITOR_SERVICE_CONFIG_JSON: '{"other":1}' }), undefined);
});

test('公開 URL と許可 Host の読み取り', () => {
  assert.equal(parsePublicOrigin(undefined), null);
  assert.equal(parsePublicOrigin('https://tendentia.example.com'), 'https://tendentia.example.com');
  assert.throws(() => parsePublicOrigin('http://tendentia.example.com'), /https/);
  assert.throws(() => parsePublicOrigin('https://tendentia.example.com/path'), /https/);
  assert.deepEqual(parseAllowedHosts(' .example.com, a.test '), ['.example.com', 'a.test']);
  assert.throws(() => parseAllowedHosts('bad host'), /不正/);
  const entrance = publicEntrance({ TENDENTIA_SELF_URL: 'https://tendentia.example.com', LUDIARS_ALLOWED_HOSTS: '.example.net' });
  assert.deepEqual(entrance, { origin: 'https://tendentia.example.com', hosts: ['.example.net', 'tendentia.example.com'] });
  assert.equal(matchesHost('tendentia.example.com', entrance.hosts), true);
  assert.equal(matchesHost('x.example.net', entrance.hosts), true);
  assert.equal(matchesHost('evil.com', entrance.hosts), false);
  assert.equal(matchesHost('tendentia.example.com@evil.com', entrance.hosts), false);
});

function fakeContext(headers: Record<string, string>, method = 'GET'): Context {
  const lower = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
  return { req: { method, header: (name: string) => lower[name.toLowerCase()] } } as unknown as Context;
}

const entrance = { origin: 'https://tendentia.example.com', hosts: ['tendentia.example.com'] };

test('入口の判定 (Access あり): 同じ端末は通し、 公開 Host は JWT と書き込みの Origin を見て、 それ以外は断る', async () => {
  const gate = new AccessGate({ entrance, verifier: verifier(), sameMachine: (c) => c.req.header('host') === '127.0.0.1:4450' });
  assert.deepEqual(await gate.decide(fakeContext({ host: '127.0.0.1:4450' })), { ok: true, via: 'local', canEdit: true });
  assert.deepEqual(await gate.decide(fakeContext({ host: 'tendentia.example.com', 'cf-access-jwt-assertion': token(valid) })),
    { ok: true, via: 'public', canEdit: true, email: 'neco@example.com' });
  assert.equal((await gate.decide(fakeContext({ host: 'tendentia.example.com' }))).ok, false);
  const crossSite = await gate.decide(fakeContext({ host: 'tendentia.example.com', 'cf-access-jwt-assertion': token(valid), origin: 'https://evil.com' }, 'POST'));
  assert.deepEqual(crossSite, { ok: false, status: 403, reason: '別のサイトからの要求は受け付けません' });
  const other = await gate.decide(fakeContext({ host: 'evil.com', 'cf-access-jwt-assertion': token(valid) }));
  assert.equal(other.ok ? 0 : other.status, 403);
});

test('アプリ: 公開 Host からの API と画面は JWT が要り、 health は誰でも見られる', async () => {
  const db = new Database(':memory:');
  ensureSchema(db);
  const gate = new AccessGate({ entrance, verifier: verifier(), sameMachine: () => false });
  const app = makeApp({ db, webDir: 'Z:/no-such-dir', version: '0.1.0', gate });
  const at = (path: string, headers: Record<string, string> = {}) => app.request(`https://tendentia.example.com${path}`, { headers: { host: 'tendentia.example.com', ...headers } });
  assert.equal((await at('/health')).status, 200);
  assert.equal((await at('/api/trend-crawler/overview')).status, 403);
  assert.equal((await at('/')).status, 403);
  const authed = { 'cf-access-jwt-assertion': token(valid) };
  assert.equal((await at('/api/trend-crawler/overview', authed)).status, 200);
  // 画面のファイルは無いので 503 (認証は通った)。
  assert.equal((await at('/', authed)).status, 503);
});

test('入口の判定 (全公開 = Access なし): 公開 Host は閲覧だけ誰でも通し、 書き込みは断る', async () => {
  const gate = new AccessGate({ entrance, sameMachine: () => false });
  assert.deepEqual(await gate.decide(fakeContext({ host: 'tendentia.example.com' })), { ok: true, via: 'public', canEdit: false });
  assert.deepEqual(await gate.decide(fakeContext({ host: 'tendentia.example.com' }, 'HEAD')), { ok: true, via: 'public', canEdit: false });
  const write = await gate.decide(fakeContext({ host: 'tendentia.example.com' }, 'PUT'));
  assert.equal(write.ok ? 0 : write.status, 403);
  const other = await gate.decide(fakeContext({ host: 'evil.com' }));
  assert.equal(other.ok ? 0 : other.status, 403);
});

test('アプリ (全公開): 公開 Host から一覧と画面は見られ、 変更の API は断り、 変更できないことを画面に知らせる', async () => {
  const db = new Database(':memory:');
  ensureSchema(db);
  const app = makeApp({ db, webDir: 'Z:/no-such-dir', version: '0.1.0', gate: new AccessGate({ entrance, sameMachine: () => false }) });
  const at = (path: string, init: RequestInit = {}) => app.request(`https://tendentia.example.com${path}`, { ...init, headers: { host: 'tendentia.example.com', ...(init.headers as Record<string, string> | undefined) } });
  assert.equal((await at('/api/trend-crawler/overview')).status, 200);
  assert.equal((await at('/api/trend-crawler/map')).status, 200);
  assert.deepEqual(await (await at('/api/trend-crawler/access')).json(), { canEdit: false });
  assert.equal((await at('/api/trend-crawler/refresh', { method: 'POST' })).status, 403);
  assert.equal((await at('/api/trend-crawler/interest', { method: 'PUT', body: '{}' })).status, 403);
  assert.equal((await at('/api/trend-crawler/click', { method: 'POST', body: '{}' })).status, 403);
  // 画面のファイルは無いので 503 (入口は通った)。
  assert.equal((await at('/')).status, 503);
});
