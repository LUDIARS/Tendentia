import type { CernereUser } from "./types.js";
import { type CapturedServiceOperation, type CapturedResourceOperation } from "./captured-operation.js";
export interface BoundServiceSession {
    projectToken: string;
    sessionBinding: string;
    user: CernereUser;
    projectKey: string;
    expiresAt: string;
}
export interface ServiceOperation {
    action: string;
    resource: string;
    /** Exact request bytes used by the service, including a sensitive GET's empty body. */
    body: string | Uint8Array;
    /** Reuse only according to the service's explicit idempotency contract. */
    requestId?: string;
}
export interface ResourceOperation<T> {
    /** Destination-owned classification must agree with Cr, including for GET. */
    risk: ServiceOperationRisk;
    /** Must consult current target-data permissions immediately before execute. */
    authorizeResource: (decision: ServiceOperationDecision) => boolean | Promise<boolean>;
    execute: () => T | Promise<T>;
}
export type ServiceOperationRisk = "read" | "sensitive_read" | "important";
export interface ServiceOperationDecision {
    risk: ServiceOperationRisk;
    requestId: string;
}
export declare function isServiceOperationRisk(value: unknown): value is ServiceOperationRisk;
export type AuthorityCall = (action: string, body: unknown) => Promise<unknown>;
export declare class CompositeAuthorityError extends Error {
    readonly status: number;
    constructor(status: number);
}
/** Shared permit preparation for service-owned and Cr-owned execution endpoints.
 * @implements SPEC-COMPOSITE-OPERATION-GUARD
 */
export declare function prepareServiceOperation(call: AuthorityCall, session: BoundServiceSession, operation: ServiceOperation, risk: ServiceOperationRisk): Promise<{
    body: {
        projectToken: string;
        sessionBinding: string;
        action: string;
        resource: string;
        requestId: string;
        contentDigest: string;
    };
    permit: string;
    risk: ServiceOperationRisk;
}>;
export declare function readServiceMetadata(value: unknown): Pick<BoundServiceSession, "user" | "expiresAt" | "projectKey">;
/** Shared live gate. It never caches authorization or retries an operation. @implements SPEC-COMPOSITE-OPERATION-GUARD */
export declare class CompositeServiceSessions {
    private readonly call;
    constructor(call: AuthorityCall);
    /** The host owns capture disposal. @implements SPEC-COMPOSITE-UPLOAD-RESERVATION */
    runCaptured<T>(session: BoundServiceSession, operation: CapturedServiceOperation, resource: CapturedResourceOperation<T>): Promise<T>;
    bind(projectToken: string, opaqueSessionId: string): Promise<BoundServiceSession>;
    check(session: BoundServiceSession): Promise<BoundServiceSession>;
    revoke(session: BoundServiceSession): Promise<void>;
    run<T>(session: BoundServiceSession, operation: ServiceOperation, resource: ResourceOperation<T>): Promise<T>;
    private credentials;
}
