import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { generateKeyPair, isValidPubKey, open, seal } from '../../src/services/sealedBox.js';
import { newHubSecret, sha256Hex } from '../../src/services/secrets.js';

const vector = JSON.parse(readFileSync(new URL('../fixtures/sealedBox.vector.json', import.meta.url), 'utf8'));

describe('sealed box', () => {
  it('round-trips utf8 JSON with crypto_box_seal_open', async () => {
    const kp = await generateKeyPair();
    const msg = JSON.stringify({ a: 1, s: 'Nhà của tôi' });
    const c = await seal(msg, kp.pk);
    expect(c).toMatch(/^[A-Za-z0-9+/]+={0,2}$/);
    expect(c).not.toContain(msg);
    expect(await open(c, kp.pk, kp.sk)).toBe(msg);
  });

  it('is randomized (two seals differ) and fails with the wrong key', async () => {
    const a = await generateKeyPair();
    const b = await generateKeyPair();
    const c1 = await seal('x', a.pk);
    expect(await seal('x', a.pk)).not.toBe(c1);
    await expect(open(c1, b.pk, b.sk)).rejects.toThrow();
  });

  it('opens the exported test vector (shared with hub B08)', async () => {
    expect(await open(vector.ciphertext, vector.pk, vector.sk)).toBe(vector.plaintext);
  });

  it('validates hubPubKey as base64 of 32 bytes', async () => {
    expect(isValidPubKey((await generateKeyPair()).pk)).toBe(true);
    expect(isValidPubKey('')).toBe(false);
    expect(isValidPubKey('not base64!')).toBe(false);
    expect(isValidPubKey(Buffer.alloc(31).toString('base64'))).toBe(false);
    expect(isValidPubKey(Buffer.alloc(32).toString('base64url').replace(/=/g, '') + '-')).toBe(false);
  });
});

describe('hub secret', () => {
  it('is 32 random bytes base64url', () => {
    const s = newHubSecret();
    expect(s).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(Buffer.from(s, 'base64url')).toHaveLength(32);
    expect(newHubSecret()).not.toBe(s);
  });

  it('sha256Hex matches node crypto', () => {
    expect(sha256Hex('abc')).toBe(createHash('sha256').update('abc').digest('hex'));
    expect(sha256Hex('abc')).toMatch(/^[0-9a-f]{64}$/);
  });
});
