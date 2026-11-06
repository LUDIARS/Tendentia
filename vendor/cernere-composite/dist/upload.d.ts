import { type DelegatedHttpOperation, type DelegationTarget, type DelegationDecision } from "./delegation.js";
import { type AuthorityCall, type BoundServiceSession } from "./service-session.js";
import { type UploadLimits, type UploadOwner } from "./upload-body.js";
export type UploadHttpOperation = Omit<DelegatedHttpOperation, "body"> & {
    body: Blob;
};
export type IncomingUploadOperation = Omit<DelegatedHttpOperation, "body" | "requestId"> & {
    requestId: string;
};
export interface UploadCredential {
    arrivalToken: string;
    requestId: string;
    expiresAt: string;
}
export interface UploadCapture {
    body: Blob;
    dispose: () => Promise<void>;
}
export interface UploadCaptureLimits extends UploadLimits {
    byteLength: number;
    expiresAt: string;
    signal: AbortSignal;
}
export interface UploadResourceOperation<T> extends UploadOwner {
    risk: "important";
    limits: UploadLimits;
    /** Must bound private memory/disk/concurrency, observe signal and clean up failed capture. */
    capture: (limits: UploadCaptureLimits) => Promise<UploadCapture>;
    authorizeResource: (decision: DelegationDecision) => boolean | Promise<boolean>;
    execute: (body: Blob, decision: DelegationDecision) => T | Promise<T>;
}
/** @implements SPEC-COMPOSITE-UPLOAD-RESERVATION */
export declare class CompositeUploads {
    private readonly call;
    private readonly projectKey;
    constructor(call: AuthorityCall, projectKey: string);
    issue(session: BoundServiceSession, target: DelegationTarget, operation: UploadHttpOperation, owner: UploadOwner & {
        risk: "important";
    }): Promise<UploadCredential>;
    run<T>(arrivalToken: string, operation: IncomingUploadOperation, resource: UploadResourceOperation<T>): Promise<T>;
}
