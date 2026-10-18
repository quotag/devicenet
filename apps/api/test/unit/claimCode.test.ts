import { describe, it, expect } from 'vitest';
import { ClaimCode } from '@devicenet/shared';
import { CLAIM_ALPHABET, newClaimCode, normalizeClaimCode } from '../../src/services/claimCode.js';

describe('claim code', () => {
  it('alphabet has 32 chars without 0/O/1/I', () => {
    expect(new Set(CLAIM_ALPHABET).size).toBe(32);
    for (const c of '0O1I') expect(CLAIM_ALPHABET).not.toContain(c);
  });

  it('generates codes accepted by the shared ClaimCode.code schema', () => {
    const code = ClaimCode.shape.code;
    const seen = new Set<string>();
    for (let i = 0; i < 2000; i++) {
      const c = newClaimCode();
      expect(code.safeParse(c).success).toBe(true);
      seen.add(c);
    }
    expect(seen.size).toBeGreaterThan(1990);
  });

  it('uses the whole alphabet', () => {
    const chars = new Set(Array.from({ length: 500 }, newClaimCode).join(''));
    expect(chars.size).toBe(32);
  });

  it('normalizes user input', () => {
    expect(normalizeClaimCode(' abcd-2345 ')).toBe('ABCD2345');
  });
});
