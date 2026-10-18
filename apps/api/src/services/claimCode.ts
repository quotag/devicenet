import { randomInt } from 'node:crypto';

/** base32 without 0/O/1/I — matches shared `ClaimCode.code` `^[A-HJ-NP-Z2-9]{8}$`. */
export const CLAIM_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const CLAIM_CODE_RE = /^[A-HJ-NP-Z2-9]{8}$/;
export const CLAIM_TTL_MS = 15 * 60 * 1000;

export function newClaimCode(): string {
  let s = '';
  for (let i = 0; i < 8; i++) s += CLAIM_ALPHABET[randomInt(CLAIM_ALPHABET.length)];
  return s;
}

/** User-typed code → canonical form (trim, upper-case, drop spaces/dashes). Not validated. */
export const normalizeClaimCode = (s: string) => s.trim().toUpperCase().replace(/[\s-]/g, '');
