/// <reference lib="dom" />
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadSession, receiveAuthCode } from '../src/account-view.ts';
test('popup handoff accepts only exact origin/source/state, then removes its listener', async t => {
  const target = new EventTarget(), popup = { closed: false } as Window;
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'window');
  Object.defineProperty(globalThis, 'window', { value: target, configurable: true });
  t.after(() => { if (previous) Object.defineProperty(globalThis, 'window', previous); else Reflect.deleteProperty(globalThis, 'window'); });
  const removed = t.mock.method(target, 'removeEventListener');
  const controller = new AbortController(); t.after(() => controller.abort());
  let settled = false;
  const receiving = receiveAuthCode(popup, 'https://cr.example.com', 'state', controller.signal).then(code => { settled = true; return code; });
  const send = (origin: string, source: unknown, state: string) => {
    const event = new Event('message');
    Object.defineProperties(event, { origin: { value: origin }, source: { value: source },
      data: { value: { type: 'cernere:auth', authCode: 'code', state } } });
    target.dispatchEvent(event);
  };
  send('https://evil.example', popup, 'state'); send('https://cr.example.com', {}, 'state'); send('https://cr.example.com', popup, 'wrong');
  await Promise.resolve(); assert.equal(settled, false);
  send('https://cr.example.com', popup, 'state'); assert.equal(await receiving, 'code');
  assert.equal(removed.mock.callCount(), 1);
});
test('owner abort disposes the popup receiver without waiting for timeout', async t => {
  const target = new EventTarget(), previous = Object.getOwnPropertyDescriptor(globalThis, 'window');
  Object.defineProperty(globalThis, 'window', { value: target, configurable: true });
  t.after(() => { if (previous) Object.defineProperty(globalThis, 'window', previous); else Reflect.deleteProperty(globalThis, 'window'); });
  const controller = new AbortController();
  const receiving = receiveAuthCode({ closed: false } as Window, 'https://cr.example.com', 'state', controller.signal);
  controller.abort(); await assert.rejects(receiving, /中断/);
});
test('rejected stale session still exposes the explicit reauthentication action', async t => {
  t.mock.method(globalThis, 'fetch', async () => Response.json({
    loginAvailable: true,
    cernereUrl: 'https://cr.example.com',
    user: null,
    error: 'ログインをやり直してください',
  }, { status: 403 }));
  const session = await loadSession();
  assert.equal(session.loginAvailable, true);
  assert.equal(session.cernereUrl, 'https://cr.example.com');
  assert.equal(session.user, null);
});
