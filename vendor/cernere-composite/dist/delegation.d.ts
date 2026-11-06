import { type AuthorityCall, type BoundServiceSession, type ServiceOperation, type ServiceOperationRisk } from "./service-session.js";
export interface DelegatedHttpOperation extends ServiceOperation {
    method: "GET" | "HEAD" | "POST" | "PUT" | "PATCH" | "DELETE";
    /** Exact canonical pathname + query sent to the destination. resource must equal path. */
    path: string;
    /** Actual outgoing/incoming headers, after body serialization. */
    headers: Headers;
    /** Additional route-owned header names that influence authorization or semantics. */
    additionalHeaders?: readonly string[];
}
export interface DelegationTarget {
    projectKey: string;
    audience: string;
}
export interface DelegationCredential {
    delegationToken: string;
    requestId: string;
    expiresAt: string;
}
export interface DelegationDecision extends Pick<BoundServiceSession, "user" | "projectKey" | "expiresAt"> {
    sourceProject: string;
    requestId: string;
    risk: ServiceOperationRisk;
}
export interface DelegatedResourceOperation<T> {
    risk: ServiceOperationRisk;
    authorizeResource: (decision: DelegationDecision) => boolean | Promise<boolean>;
    execute: (decision: DelegationDecision) => T | Promise<T>;
}
/** Canonical digest of semantic headers, never an authentication credential.
 * Both endpoints use the destination's route-owned additional list.
 * @implements SPEC-COMPOSITE-DELEGATION
 */
export declare function delegationHeadersDigest(headers: Headers, additional?: readonly string[]): string;
/** @implements SPEC-COMPOSITE-DELEGATION SPEC-COMPOSITE-UPLOAD-RESERVATION */
export declare function delegationMetadata(operation: Omit<DelegatedHttpOperation, "body">, requestId: string): {
    action: string;
    method: "GET" | "HEAD" | "POST" | "PUT" | "PATCH" | "DELETE";
    path: string;
    resource: string;
    requestId: string;
    headersDigest: string;
};
/** Online, one-operation capabilities; neither user tokens nor reusable service sessions.
 * @implements SPEC-COMPOSITE-DELEGATION
 */
export declare class CompositeDelegations {
    private readonly call;
    private readonly projectKey;
    constructor(call: AuthorityCall, projectKey: string);
    issue(session: BoundServiceSession, target: DelegationTarget, operation: DelegatedHttpOperation): Promise<DelegationCredential>;
    run<T>(token: string, operation: DelegatedHttpOperation & {
        requestId: string;
    }, resource: DelegatedResourceOperation<T>): Promise<T>;
}
