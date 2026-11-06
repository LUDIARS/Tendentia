import type { CompositeConfig, ExchangeResult } from "./types.js";
import { CompositeServiceSessions } from "./service-session.js";
import { CompositeDelegations } from "./delegation.js";
import { CompositeServiceIdentity } from "./service-identity.js";
import { CompositeUploads } from "./upload.js";
/** Service backend only. Browser verifiers are exchanged using this project's credential. */
export declare class CernereComposite {
    private readonly config;
    readonly sessions: CompositeServiceSessions;
    readonly delegations: CompositeDelegations;
    readonly identity: CompositeServiceIdentity;
    readonly uploads: CompositeUploads;
    private readonly lifetime;
    private projectCredential?;
    private credentialRequest?;
    constructor(config: CompositeConfig);
    dispose(): void;
    private signal;
    getLoginUrl(origin: string, codeChallenge: string, state: string): string;
    exchange(authCode: string, codeVerifier: string): Promise<ExchangeResult>;
    private credential;
    private authority;
    private authenticateProject;
}
