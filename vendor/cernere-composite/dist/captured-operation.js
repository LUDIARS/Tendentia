/** Service-owned large bodies use the ordinary permit after capture, without a memory copy.
 * @implements SPEC-COMPOSITE-UPLOAD-RESERVATION
 */
import { randomUUID } from "node:crypto";
import { digestCapturedBody, requireUploadOwner } from "./upload-body.js";
/** @implements SPEC-COMPOSITE-UPLOAD-RESERVATION */
export async function runCapturedServiceOperation(call, session, operation, resource) {
    if (resource.risk !== "important" || !operation.action || !operation.resource || typeof resource.authorizeResource !== "function"
        || typeof resource.execute !== "function")
        throw new Error("Classified captured operation and current resource authorization are required");
    requireUploadOwner(resource);
    const capturedBody = operation.body;
    const fixed = { action: operation.action, resource: operation.resource, requestId: operation.requestId ?? randomUUID(),
        projectToken: session.projectToken, sessionBinding: session.sessionBinding };
    const expiry = Date.parse(session.expiresAt);
    const owner = { signal: resource.signal, isCurrent: () => Number.isFinite(expiry) && Date.now() < expiry && resource.isCurrent() };
    const digest = await digestCapturedBody(capturedBody, resource.maximumBytes, owner);
    const { requestId } = fixed;
    const body = { ...fixed, contentDigest: digest.contentDigest };
    requireUploadOwner(owner);
    const permit = await call("authorize", body);
    requireUploadOwner(owner);
    if (!permit || typeof permit.permit !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(permit.permit)
        || permit.expiresIn !== 30 || permit.risk !== "important")
        throw new Error("Invalid captured operation permit");
    const result = await call("consume", { ...body, permit: permit.permit });
    requireUploadOwner(owner);
    if (result?.allowed !== true || result.requestId !== requestId || result.risk !== "important")
        throw new Error("Captured operation was not authorized");
    const decision = { requestId, risk: "important" };
    if (!await resource.authorizeResource(decision))
        throw new Error("Service resource access denied");
    requireUploadOwner(owner);
    return resource.execute(capturedBody, decision);
}
