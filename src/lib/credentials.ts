import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

const API_KEY_BYTES = 24;
const ADMIN_TOKEN_BYTES = 32;

/** Enough of the key to recognise it in a list, without being enough to use. */
export const KEY_PREFIX_LENGTH = 12;

export interface IssuedApiKey {
  /** Returned to the caller once, then unrecoverable. */
  key: string;
  hash: string;
  prefix: string;
}

/**
 * SHA-256 with no salt or stretching, deliberately: these are 192-bit random
 * secrets, so there is no dictionary to attack and a slow KDF would only add
 * latency to every request.
 */
export function hashCredential(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

export function generateApiKey(): IssuedApiKey {
  const key = `gsk_${randomBytes(API_KEY_BYTES).toString('hex')}`;
  return { key, hash: hashCredential(key), prefix: key.slice(0, KEY_PREFIX_LENGTH) };
}

export function generateAdminToken(): { token: string; hash: string } {
  const token = `gat_${randomBytes(ADMIN_TOKEN_BYTES).toString('hex')}`;
  return { token, hash: hashCredential(token) };
}

/** Compares two hex digests without leaking their difference through timing. */
export function digestsMatch(a: string, b: string): boolean {
  const left = Buffer.from(a, 'hex');
  const right = Buffer.from(b, 'hex');
  if (left.length !== right.length || left.length === 0) return false;
  return timingSafeEqual(left, right);
}
