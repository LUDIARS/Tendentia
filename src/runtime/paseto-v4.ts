// PASETO v4.public (Ed25519) の検証。 Cernere の user×project token をログインのときに確かめる。
// 依存を増やさないよう Node の Ed25519 で直接検証する (https://github.com/paseto-standard/paseto-spec)。
// 署名対象は PAE("v4.public.", 本文, footer, implicit)。 本文は JSON の claims。

import { createPublicKey, verify, type KeyObject } from 'node:crypto';

const HEADER = 'v4.public.';
const SIGNATURE_BYTES = 64;

export interface PasetoCheck {
  /** aud がこれと一致しなければ断る (別サービス向け token の流用を防ぐ)。 */
  audience: string;
  now?: Date;
}

/** Cernere が配る公開鍵 (base64 の生 32 バイト) を KeyObject にする。 長さが違えば null。 */
export function ed25519PublicKey(base64: string): KeyObject | null {
  const raw = Buffer.from(base64, 'base64');
  if (raw.length !== 32) return null;
  return createPublicKey({ key: { kty: 'OKP', crv: 'Ed25519', x: raw.toString('base64url') }, format: 'jwk' });
}

/** Pre-Authentication Encoding (PASETO の署名対象の組み立て)。 */
export function pae(pieces: Buffer[]): Buffer {
  const le64 = (n: number): Buffer => {
    const out = Buffer.alloc(8);
    out.writeBigUInt64LE(BigInt(n) & 0x7fffffffffffffffn);
    return out;
  };
  return Buffer.concat([le64(pieces.length), ...pieces.flatMap((piece) => [le64(piece.length), piece])]);
}

function parseTime(value: unknown): number | null {
  if (typeof value !== 'string') return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

/** 署名・aud・exp・nbf が正しければ claims を返す。 どれか 1 つでも違えば null。 */
export function verifyPasetoV4Public(token: string, keys: readonly KeyObject[], check: PasetoCheck): Record<string, unknown> | null {
  if (!token.startsWith(HEADER)) return null;
  const [body, footer = '', extra] = token.slice(HEADER.length).split('.');
  if (extra !== undefined || !body) return null;
  const decoded = Buffer.from(body, 'base64url');
  if (decoded.length <= SIGNATURE_BYTES) return null;
  const message = decoded.subarray(0, decoded.length - SIGNATURE_BYTES);
  const signature = decoded.subarray(decoded.length - SIGNATURE_BYTES);
  const signed = pae([Buffer.from(HEADER), message, Buffer.from(footer, 'base64url'), Buffer.alloc(0)]);
  if (!keys.some((key) => verify(null, signed, key, signature))) return null;

  let claims: unknown;
  try { claims = JSON.parse(message.toString('utf8')); } catch { return null; }
  if (typeof claims !== 'object' || claims === null || Array.isArray(claims)) return null;
  const record = claims as Record<string, unknown>;
  const now = (check.now ?? new Date()).getTime();
  const exp = parseTime(record.exp);
  if (exp === null || exp <= now) return null;
  if (record.nbf !== undefined) {
    const nbf = parseTime(record.nbf);
    if (nbf === null || nbf > now) return null;
  }
  if (record.aud !== check.audience) return null;
  return record;
}
