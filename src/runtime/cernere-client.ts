// Authentication and operation permits belong to the pinned Cr SDK.
import { CernereComposite } from '../../vendor/cernere-composite/dist/composite.js';
import type { CompositeConfig } from '../../vendor/cernere-composite/dist/types.js';
import type { BoundServiceSession, ResourceOperation, ServiceOperation } from '../../vendor/cernere-composite/dist/service-session.js';
import { contract } from '../../contracts/observe.ts'; /* augur-inject:import:bd1df823 */
import augurContract_5da915cb from '../../contracts/login.contract.ts'; /* augur-inject:contract-predicate:0036cb85 */
export type { BoundServiceSession };
export const CERNERE_PROJECT_KEY = 'tendentia';
export class LoginError extends Error {
  readonly status: 400 | 401 | 403 | 503;
  constructor(status: 400 | 401 | 403 | 503, message: string) { super(message); this.status = status; }
}
/** @implements SPEC-TD-SCOPED-SESSION */
export class CernereClient {
  private readonly sdk: CernereComposite;
  constructor(config: CompositeConfig) { this.sdk = new CernereComposite(config); }
  async login(code: string, verifier: string, opaque: string): Promise<BoundServiceSession> {
    const exchanged = await this.sdk.exchange(code, verifier);
    const grant = await this.sdk.sessions.bind(exchanged.projectToken, opaque);
    if (grant.projectKey !== CERNERE_PROJECT_KEY || grant.user.id !== exchanged.user.id ||
      Date.parse(grant.expiresAt) > Date.now() + 15 * 60_000) {
      await this.sdk.sessions.revoke(grant).catch(() => { /* Unknown authority result stays unusable locally. */ });
      throw new LoginError(401, 'ログインの対象が一致しません');
    }
    return grant;
  }
  check(grant: BoundServiceSession): Promise<BoundServiceSession> { return this.sdk.sessions.check(grant); }
  revoke(grant: BoundServiceSession): Promise<void> { return this.sdk.sessions.revoke(grant); }
  run<T>(grant: BoundServiceSession, operation: ServiceOperation, resource: ResourceOperation<T>): Promise<T> {
    return this.sdk.sessions.run(grant, operation, resource);
  }
  dispose(): void { this.sdk.dispose(); }
}
CernereClient.prototype.login = contract(CernereClient.prototype.login, { ...augurContract_5da915cb, contractId: 'C-1', mode: 'observe', sample: 1, where: 'src/runtime/cernere-client.ts:14', rule: 'contract-wrap', id: '5da915cb' }); /* augur-inject:contract-wrap:5da915cb */
