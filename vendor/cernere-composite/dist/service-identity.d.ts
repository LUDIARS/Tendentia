/** Cr-owned resources restricted to the current scoped session's own native account.
 * @implements SPEC-COMPOSITE-SCOPED-IDENTITY
 */
import { type AuthorityCall, type BoundServiceSession } from './service-session.js';
export interface OwnOrganizationMembership {
    id: string;
    name: string;
    role: string;
}
export interface OwnFaceConsent {
    facilityId: string;
    consentId: string;
    policyVersion: string;
    at: string;
    reconsentRequired: boolean;
}
/** The service must check its current local owner after asynchronous permission work. */
export interface ScopedIdentitySession {
    grant: BoundServiceSession;
    isCurrent: () => boolean;
}
export declare class CompositeServiceIdentity {
    private readonly call;
    constructor(call: AuthorityCall);
    organizations(session: ScopedIdentitySession): Promise<OwnOrganizationMembership[]>;
    faceConsentStatus(session: ScopedIdentitySession): Promise<OwnFaceConsent[]>;
    createFaceConsent(session: ScopedIdentitySession, facilityId: string, policyVersion: string): Promise<void>;
    revokeFaceConsent(session: ScopedIdentitySession, facilityId?: string): Promise<void>;
    private execute;
}
