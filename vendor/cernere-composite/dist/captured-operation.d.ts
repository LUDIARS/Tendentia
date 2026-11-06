import type { AuthorityCall, BoundServiceSession, ServiceOperation, ServiceOperationDecision } from "./service-session.js";
import { type UploadOwner } from "./upload-body.js";
export type CapturedServiceOperation = Omit<ServiceOperation, "body"> & {
    body: Blob;
};
export interface CapturedResourceOperation<T> extends UploadOwner {
    risk: "important";
    maximumBytes: number;
    authorizeResource: (decision: ServiceOperationDecision) => boolean | Promise<boolean>;
    execute: (body: Blob, decision: ServiceOperationDecision) => T | Promise<T>;
}
/** @implements SPEC-COMPOSITE-UPLOAD-RESERVATION */
export declare function runCapturedServiceOperation<T>(call: AuthorityCall, session: BoundServiceSession, operation: CapturedServiceOperation, resource: CapturedResourceOperation<T>): Promise<T>;
