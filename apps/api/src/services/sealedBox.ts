import { createRequire } from 'node:module';

/**
 * Minimal typing of the libsodium-wrappers surface we use (the package ships no .d.ts, and its
 * ESM build is broken in 0.7.16 — `modules-esm/libsodium.mjs` is missing — so load the CJS build).
 */
export interface Sodium {
  ready: Promise<void>;
  crypto_box_PUBLICKEYBYTES: number;
  crypto_box_keypair(): { publicKey: Uint8Array; privateKey: Uint8Array };
  crypto_box_seal(message: Uint8Array, publicKey: Uint8Array): Uint8Array;
  crypto_box_seal_open(ciphertext: Uint8Array, publicKey: Uint8Array, privateKey: Uint8Array): Uint8Array;
}

const sodium = createRequire(import.meta.url)('libsodium-wrappers') as Sodium;

export async function getSodium(): Promise<Sodium> {
  await sodium.ready;
  return sodium;
}

/** Standard base64 (with padding) — the wire encoding of `hubPubKey` and of `credential`. */
export const b64 = {
  encode: (u: Uint8Array) => Buffer.from(u).toString('base64'),
  decode: (s: string) => new Uint8Array(Buffer.from(s, 'base64')),
};

/** true when `s` is canonical base64 of exactly 32 bytes (X25519 public key). */
export function isValidPubKey(s: string): boolean {
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(s)) return false;
  const bytes = b64.decode(s);
  return bytes.length === 32 && b64.encode(bytes) === s;
}

/** crypto_box_seal(utf8(plaintext), pk) → base64. */
export async function seal(plaintext: string, pubKeyB64: string): Promise<string> {
  const s = await getSodium();
  return b64.encode(s.crypto_box_seal(new TextEncoder().encode(plaintext), b64.decode(pubKeyB64)));
}

/** Inverse of `seal` (what the hub does). Throws on bad key / tampered ciphertext. */
export async function open(ciphertextB64: string, pubKeyB64: string, privKeyB64: string): Promise<string> {
  const s = await getSodium();
  const out = s.crypto_box_seal_open(b64.decode(ciphertextB64), b64.decode(pubKeyB64), b64.decode(privKeyB64));
  return new TextDecoder().decode(out);
}

export async function generateKeyPair(): Promise<{ pk: string; sk: string }> {
  const s = await getSodium();
  const kp = s.crypto_box_keypair();
  return { pk: b64.encode(kp.publicKey), sk: b64.encode(kp.privateKey) };
}
