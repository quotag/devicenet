import { mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { deleteKeyPair, loadOrCreateKeyPair, openSealed } from '../../src/claim/keys.js';
const vector = JSON.parse(readFileSync(new URL('../fixtures/sealed-vector.json', import.meta.url), 'utf8')) as Record<'pk' | 'sk' | 'plaintext' | 'ciphertext', string>;

const tmp = () => mkdtempSync(join(tmpdir(), 'claim-keys-'));

describe('claim keys', () => {
  it('decrypts the api sealed-box test vector', async () => {
    expect(await openSealed(vector.ciphertext, { pk: vector.pk, sk: vector.sk })).toBe(vector.plaintext);
  });

  it('rejects a tampered ciphertext / wrong key', async () => {
    const bad = Buffer.from(vector.ciphertext, 'base64');
    bad[40] ^= 1;
    await expect(openSealed(bad.toString('base64'), { pk: vector.pk, sk: vector.sk })).rejects.toThrow();
    const dir = tmp();
    const other = await loadOrCreateKeyPair(join(dir, 'hub.key'));
    await expect(openSealed(vector.ciphertext, other)).rejects.toThrow();
  });

  it('generates once, persists {pk, sk} and reloads the same pair', async () => {
    const p = join(tmp(), 'sub', 'hub.key');
    const a = await loadOrCreateKeyPair(p);
    expect(Buffer.from(a.pk, 'base64')).toHaveLength(32);
    expect(JSON.parse(readFileSync(p, 'utf8'))).toEqual(a);
    if (process.platform !== 'win32') expect(statSync(p).mode & 0o777).toBe(0o600);
    expect(await loadOrCreateKeyPair(p)).toEqual(a);
    expect(deleteKeyPair(p)).toBe(true);
    expect(deleteKeyPair(p)).toBe(false);
    expect(await loadOrCreateKeyPair(p)).not.toEqual(a);
  });

  it('regenerates a corrupt key file', async () => {
    const p = join(tmp(), 'hub.key');
    writeFileSync(p, 'garbage');
    const kp = await loadOrCreateKeyPair(p);
    expect(JSON.parse(readFileSync(p, 'utf8'))).toEqual(kp);
  });
});
