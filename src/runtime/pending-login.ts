// A browser owns one pending attempt. Taking it is synchronous and one-use before exchange.
import { createHash } from 'node:crypto';
import { newSessionId } from './user-session.ts';
interface Pending { nonce: string; state: string; challenge: string; expiresAt: number; active: boolean; close?: () => void }
/** @implements SPEC-TD-SCOPED-SESSION */
export class PendingLogins {
  private readonly attempts = new Map<string, Pending>();
  private readonly clock: () => number;
  constructor(clock: () => number = Date.now) { this.clock = clock; }
  start(owner: string | undefined, challenge: string, state: string): { owner: string; nonce: string } {
    this.cancel(owner);
    for (const [key, item] of this.attempts) if (item.expiresAt <= this.clock()) this.attempts.delete(key);
    if (this.attempts.size >= 1000) throw new Error('Too many pending logins');
    const id = newSessionId(), nonce = newSessionId();
    this.attempts.set(id, { nonce, state, challenge, expiresAt: this.clock() + 300_000, active: true });
    return { owner: id, nonce };
  }
  take(owner: string | undefined, nonce: string, state: string, verifier: string): () => boolean {
    const pending = owner ? this.attempts.get(owner) : undefined;
    if (!pending || !pending.active) throw new Error('Login attempt ended');
    pending.active = false;
    if (pending.expiresAt <= this.clock() || pending.nonce !== nonce || pending.state !== state ||
      createHash('sha256').update(verifier).digest('base64url') !== pending.challenge) { this.cancel(owner); throw new Error('Login binding mismatch'); }
    return () => this.attempts.get(owner!) === pending && pending.expiresAt > this.clock();
  }
  finish(owner: string | undefined, close: () => void): void {
    const pending = owner ? this.attempts.get(owner) : undefined;
    if (!pending || pending.active || pending.expiresAt <= this.clock()) { close(); throw new Error('Login owner ended'); }
    pending.close = close;
  }
  cancelNonce(nonce: string): void {
    for (const [owner, pending] of this.attempts) if (pending.nonce === nonce) this.cancel(owner);
  }
  cancel(owner: string | undefined): void {
    if (!owner) return;
    const pending = this.attempts.get(owner);
    this.attempts.delete(owner);
    pending?.close?.();
  }
}
