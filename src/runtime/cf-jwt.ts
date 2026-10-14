import { createPublicKey, verify, type JsonWebKey } from 'node:crypto';

export interface JwtParts {
  header: { alg?: unknown; kid?: unknown };
  payload: Record<string, unknown>;
  signingInput: string;
  signature: Buffer;
}

const segment = /^[A-Za-z0-9_-]+$/;
function decodeObject(value: string): Record<string, unknown> | undefined {
  const parsed: unknown = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
  return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed) ? parsed as Record<string, unknown> : undefined;
}

/** Splits a compact JWS without trusting any of its claims. */
export function decodeJwt(token: string): JwtParts | undefined {
  const parts = token.split('.');
  if (parts.length !== 3 || parts.some(part => !segment.test(part))) return undefined;
  try {
    const header = decodeObject(parts[0]);
    const payload = decodeObject(parts[1]);
    if (!header || !payload) return undefined;
    return { header, payload, signingInput: parts[0] + '.' + parts[1], signature: Buffer.from(parts[2], 'base64url') };
  } catch { return undefined; }
}

/** RS256 signature check against one JWK. Any key or algorithm mismatch is a failure, never an exception. */
export function verifyRs256(parts: JwtParts, jwk: JsonWebKey): boolean {
  if (parts.header.alg !== 'RS256' || jwk.kty !== 'RSA') return false;
  try {
    return verify('RSA-SHA256', Buffer.from(parts.signingInput, 'utf8'), createPublicKey({ key: jwk, format: 'jwk' }), parts.signature);
  } catch { return false; }
}
