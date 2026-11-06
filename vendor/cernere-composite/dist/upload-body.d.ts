export interface UploadOwner {
    isCurrent: () => boolean;
    signal?: AbortSignal;
}
export interface UploadLimits {
    maximumBytes: number;
    timeoutSeconds: number;
}
/** @implements SPEC-COMPOSITE-UPLOAD-RESERVATION */
export declare function requireUploadLimits(value: UploadLimits): UploadLimits;
/** @implements SPEC-COMPOSITE-UPLOAD-RESERVATION */
export declare function requireUploadOwner(owner: UploadOwner): void;
/** @implements SPEC-COMPOSITE-UPLOAD-RESERVATION */
export declare function digestCapturedBody(body: Blob, maximumBytes: number, owner: UploadOwner): Promise<{
    contentDigest: string;
    byteLength: number;
}>;
