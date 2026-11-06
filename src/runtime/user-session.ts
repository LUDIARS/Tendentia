// Process-owned opaque sessions. Restart logs everybody out; no bearer reaches the browser.
import { createHash, randomBytes } from 'node:crypto';
import type { BoundServiceSession, CernereClient } from './cernere-client.ts';
import type { ServiceOperationRisk } from '../../vendor/cernere-composite/dist/service-session.js';
import { contract } from '../../contracts/observe.ts'; /* augur-inject:import:36bcc27d */
import augurContract_2d442795 from '../../contracts/session.contract.ts'; /* augur-inject:contract-predicate:bbb8155a */
export const SESSION_COOKIE = 'td_session';
export interface SessionUser { userId: string; displayName: string | null; expiresAt: number }
interface OwnedSession { grant: BoundServiceSession; user: SessionUser }
const MAX_SESSIONS = 10_000;
/** @implements SPEC-TD-SCOPED-SESSION */
export class SessionSigner {
  private readonly entries = new Map<string, OwnedSession>();
  private readonly client: CernereClient;
  private readonly clock: () => number;
  constructor(client: CernereClient, clock: () => number = Date.now) { this.client = client; this.clock = clock; }
  private sweep(): void { for (const [key, value] of this.entries) if (value.user.expiresAt <= this.clock()) this.entries.delete(key); }
  issue(grant: BoundServiceSession, opaque: string): string {
    this.sweep();
    const expiresAt = Date.parse(grant.expiresAt);
    if (!/^[A-Za-z0-9_-]{43}$/.test(opaque) || this.entries.has(opaque) || this.entries.size >= MAX_SESSIONS ||
      grant.sessionBinding !== createHash('sha256').update(opaque).digest('base64url') ||
      grant.projectKey !== 'tendentia' || !grant.user.id || !Number.isFinite(expiresAt) || expiresAt <= this.clock() ||
      expiresAt > this.clock() + 15 * 60_000) throw new Error('Invalid local session');
    this.entries.set(opaque, { grant, user: { userId: grant.user.id, displayName: grant.user.displayName, expiresAt } });
    return opaque;
  }
  read(value: string | undefined): SessionUser | null {
    if (!value) return null;
    const entry = this.entries.get(value);
    if (!entry) return null;
    if (entry.user.expiresAt <= this.clock()) { this.entries.delete(value); return null; }
    return { ...entry.user };
  }
  async check(value: string | undefined): Promise<SessionUser | null> {
    // Unknown attacker-supplied cookies are not owned sessions. Avoid invoking
    // the observed read path (and its audit I/O) unless this process issued it.
    if (!value || !this.entries.has(value) || !this.read(value)) return null;
    const entry = this.entries.get(value)!;
    try {
      const checked = await this.client.check(entry.grant);
      if (this.entries.get(value) !== entry || !this.read(value) || Date.parse(checked.expiresAt) > entry.user.expiresAt) throw new Error('Session owner ended');
      entry.user.expiresAt = Math.min(entry.user.expiresAt, Date.parse(checked.expiresAt));
      return this.read(value);
    } catch { this.entries.delete(value); return null; }
  }
  async revoke(value: string | undefined): Promise<void> {
    if (!value) return;
    const entry = this.entries.get(value);
    this.entries.delete(value); // End local ownership before remote I/O, even if revoke fails.
    if (entry) await this.client.revoke(entry.grant);
  }
  async run<T>(value: string, userId: string, action: string, resource: string, risk: ServiceOperationRisk, body: string, execute: () => T): Promise<T> {
    const entry = this.entries.get(value);
    if (!entry || this.read(value)?.userId !== userId) throw new Error('Session owner ended');
    const current = (): boolean => this.entries.get(value) === entry && this.read(value)?.userId === userId;
    let executing = false;
    try {
      return await this.client.run(entry.grant, { action, resource, body }, {
        risk, authorizeResource: current,
        execute: () => { if (!current()) throw new Error('Session owner ended'); executing = true; return execute(); },
      });
    } catch (error) {
      // Failed online authority ends ownership. A database/response failure
      // after execution starts does not prove this bound identity was revoked.
      // No operation is retried; its original failure remains observable.
      if (!executing) this.entries.delete(value);
      throw error;
    }
  }
}
SessionSigner.prototype.read = contract(SessionSigner.prototype.read, { ...augurContract_2d442795, contractId: 'C-2', mode: 'observe', sample: 1, where: 'src/runtime/user-session.ts:22', rule: 'contract-wrap', id: '2d442795' }); /* augur-inject:contract-wrap:2d442795 */
export function newSessionId(): string { return randomBytes(32).toString('base64url'); }
export function readCookie(header: string | undefined, name: string): string | undefined {
  for (const part of (header ?? '').split(';')) {
    const index = part.indexOf('=');
    if (index > 0 && part.slice(0, index).trim() === name) {
      try { return decodeURIComponent(part.slice(index + 1).trim()); } catch { return undefined; }
    }
  }
  return undefined;
}
