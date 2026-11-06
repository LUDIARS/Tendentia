import { createHash, randomUUID } from "node:crypto";
import { runCapturedServiceOperation } from "./captured-operation.js";
export function isServiceOperationRisk(value) {
    return value === "read" || value === "sensitive_read" || value === "important";
}
export class CompositeAuthorityError extends Error {
    status;
    constructor(status) {
        super(`Cernere service authority denied or unavailable (${status})`);
        this.status = status;
    }
}
/** Shared permit preparation for service-owned and Cr-owned execution endpoints.
 * @implements SPEC-COMPOSITE-OPERATION-GUARD
 */
export async function prepareServiceOperation(call, session, operation, risk) {
    if (!isServiceOperationRisk(risk) || !operation.action || !operation.resource)
        throw new Error("Classified service action, resource and risk are required");
    if (!Number.isFinite(Date.parse(session.expiresAt)) || Date.parse(session.expiresAt) <= Date.now())
        throw new Error("Service session expired; sign in again");
    const requestId = operation.requestId ?? randomUUID();
    const body = { projectToken: session.projectToken, sessionBinding: session.sessionBinding,
        action: operation.action, resource: operation.resource, requestId,
        contentDigest: createHash("sha256").update(operation.body).digest("base64url") };
    const permission = await call("authorize", body);
    if (!permission || typeof permission.permit !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(permission.permit) || permission.expiresIn !== 30
        || !isServiceOperationRisk(permission.risk) || permission.risk !== risk)
        throw new Error("Invalid service operation permit or risk mismatch");
    return { body, permit: permission.permit, risk: permission.risk };
}
export function readServiceMetadata(value) {
    const data = value;
    if (!data || typeof data.projectKey !== "string" || typeof data.expiresAt !== "string" || !Number.isFinite(Date.parse(data.expiresAt))
        || Date.parse(data.expiresAt) <= Date.now() || !data.user || typeof data.user.id !== "string" || typeof data.user.role !== "string"
        || typeof data.user.displayName !== "string" || (data.user.email !== null && typeof data.user.email !== "string"))
        throw new Error("Invalid service authority response");
    return { user: data.user, expiresAt: data.expiresAt, projectKey: data.projectKey };
}
/** Shared live gate. It never caches authorization or retries an operation. @implements SPEC-COMPOSITE-OPERATION-GUARD */
export class CompositeServiceSessions {
    call;
    constructor(call) {
        this.call = call;
    }
    /** The host owns capture disposal. @implements SPEC-COMPOSITE-UPLOAD-RESERVATION */
    runCaptured(session, operation, resource) {
        return runCapturedServiceOperation(this.call, session, operation, resource);
    }
    async bind(projectToken, opaqueSessionId) {
        if (!projectToken || opaqueSessionId.length < 32 || opaqueSessionId.length > 512)
            throw new Error("A random service session ID is required");
        const sessionBinding = createHash("sha256").update(opaqueSessionId, "utf8").digest("base64url");
        const result = readServiceMetadata(await this.call("bind", { projectToken, sessionBinding }));
        return { projectToken, sessionBinding, ...result };
    }
    async check(session) {
        const result = readServiceMetadata(await this.call("check", this.credentials(session)));
        if (result.user.id !== session.user.id || result.projectKey !== session.projectKey || result.user.role !== session.user.role)
            throw new Error("Service session identity changed");
        return { ...session, ...result };
    }
    async revoke(session) {
        const result = await this.call("revoke", this.credentials(session));
        if (result?.revoked !== true)
            throw new Error("Service session revocation was not confirmed");
    }
    async run(session, operation, resource) {
        if (typeof resource.authorizeResource !== "function" || typeof resource.execute !== "function")
            throw new Error("Current resource authorization is required");
        const permission = await prepareServiceOperation(this.call, session, operation, resource.risk);
        const { body } = permission;
        const requestId = body.requestId;
        const consumed = await this.call("consume", { ...body, permit: permission.permit });
        if (consumed?.allowed !== true || consumed.requestId !== requestId || consumed.risk !== permission.risk)
            throw new Error("Service operation was not authorized");
        // No remote I/O follows local authorization. The service can put these two
        // callbacks inside its own transaction; Cr consumption is not that transaction.
        if (!await resource.authorizeResource({ risk: permission.risk, requestId }))
            throw new Error("Service resource access denied");
        return resource.execute();
    }
    credentials(session) {
        if (!Number.isFinite(Date.parse(session.expiresAt)) || Date.parse(session.expiresAt) <= Date.now())
            throw new Error("Service session expired; sign in again");
        return { projectToken: session.projectToken, sessionBinding: session.sessionBinding };
    }
}
