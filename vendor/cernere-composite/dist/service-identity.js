/** Cr-owned resources restricted to the current scoped session's own native account.
 * @implements SPEC-COMPOSITE-SCOPED-IDENTITY
 */
import { prepareServiceOperation } from './service-session.js';
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export class CompositeServiceIdentity {
    call;
    constructor(call) {
        this.call = call;
    }
    async organizations(session) {
        const value = await this.execute(session, 'identity-organizations', 'identity.organizations.read', 'self:organizations', 'sensitive_read', {});
        if (!value || !Array.isArray(value.items) || value.items.length > 1000)
            throw new Error('Invalid own membership result');
        return value.items.map((row) => {
            const item = row;
            if (!item || typeof item.id !== 'string' || !uuid.test(item.id) || typeof item.name !== 'string' || typeof item.role !== 'string')
                throw new Error('Invalid own membership result');
            return { id: item.id, name: item.name, role: item.role };
        });
    }
    async faceConsentStatus(session) {
        const value = await this.execute(session, 'identity-face-consent-status', 'identity.face-consent.read', 'self:face-consent', 'sensitive_read', {});
        if (!value || !Array.isArray(value.items) || value.items.length > 1000)
            throw new Error('Invalid own consent result');
        return value.items.map((row) => {
            const item = row;
            if (!item || typeof item.facilityId !== 'string' || !uuid.test(item.facilityId) || typeof item.consentId !== 'string' || !uuid.test(item.consentId)
                || typeof item.policyVersion !== 'string' || typeof item.at !== 'string' || !Number.isFinite(Date.parse(item.at)) || typeof item.reconsentRequired !== 'boolean') {
                throw new Error('Invalid own consent result');
            }
            return { facilityId: item.facilityId, consentId: item.consentId, policyVersion: item.policyVersion, at: item.at, reconsentRequired: item.reconsentRequired };
        });
    }
    async createFaceConsent(session, facilityId, policyVersion) {
        if (!uuid.test(facilityId) || !policyVersion || policyVersion.length > 128)
            throw new Error('Facility and current consent policy are required');
        const value = await this.execute(session, 'identity-face-consent-create', 'identity.face-consent.create', 'self:face-consent', 'important', { facilityId, policyVersion });
        if (!value || typeof value.consentId !== 'string' || !uuid.test(value.consentId) || typeof value.at !== 'string' || !Number.isFinite(Date.parse(value.at))
            || value.facilityId !== facilityId || value.policyVersion !== policyVersion)
            throw new Error('Consent creation was not confirmed');
    }
    async revokeFaceConsent(session, facilityId) {
        if (facilityId !== undefined && !uuid.test(facilityId))
            throw new Error('Invalid consent facility');
        const value = await this.execute(session, 'identity-face-consent-revoke', 'identity.face-consent.revoke', 'self:face-consent', 'important', facilityId === undefined ? {} : { facilityId });
        if (value?.ok !== true)
            throw new Error('Consent revocation was not confirmed');
    }
    async execute(session, route, action, resource, risk, input) {
        const current = () => {
            if (typeof session.isCurrent !== 'function' || session.isCurrent() !== true)
                throw new Error('Local identity session owner ended');
        };
        current();
        const grant = session.grant;
        const payload = JSON.stringify(input);
        const permission = await prepareServiceOperation(this.call, grant, { action, resource, body: payload }, risk);
        current();
        // The data endpoint itself consumes the permit, then executes once. No retry.
        const value = await this.call(route, { projectToken: grant.projectToken, sessionBinding: grant.sessionBinding,
            requestId: permission.body.requestId, permit: permission.permit, payload });
        current();
        if (!value || value.requestId !== permission.body.requestId || value.risk !== risk || !Object.hasOwn(value, 'data')
            || ['accessToken', 'refreshToken', 'projectToken', 'sessionToken'].some(key => Object.hasOwn(value, key)))
            throw new Error('Invalid scoped identity response');
        return value.data;
    }
}
