import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname } from 'node:path';
import { z } from 'zod';

/**
 * Minimal typing of the libsodium-wrappers surface we use. The package ships no .d.ts and its
 * ESM build is broken in 0.7.16 (`modules-esm/libsodium.mjs` missing) — load the CJS build.
 */
interface Sodium {
  ready: Promise<void>;
  crypto_box_keypair(): { publicKey: Uint8Array; privateKey: Uint8Array };
  crypto_box_seal_open(ciphertext: Uint8Array, publicKey: Uint8Array, privateKey: Uint8Array): Uint8Array;
}

const sodium = createRequire(import.meta.url)('libsodium-wrappers') as Sodium;

async function getSodium(): Promise<Sodium> {
  await sodium.ready;
  return sodium;
}

/** Standard base64 with padding — wire encoding of `hubPubKey` and `credential` (research R5). */
const b64e = (u: Uint8Array) => Buffer.from(u).toString('base64');
const b64d = (s: string) => new Uint8Array(Buffer.from(s, 'base64'));

const KeyFile = z.object({
  pk: z.string().refine((s) => b64d(s).length === 32),
  sk: z.string().refine((s) => b64d(s).length === 32),
});
/** X25519 keypair, base64. Persisted as `hub.key` = `{pk, sk}`. */
export type HubKeyPair = z.infer<typeof KeyFile>;

/** Write `data` atomically (tmp + rename) with mode 0600; chmod is best effort (no-op on Windows ACLs). */
export function writeSecretFile(path: string, data: string): void {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, data, { mode: 0o600 });
  try {
    chmodSync(tmp, 0o600);
  } catch {
    /* best effort */
  }
  renameSync(tmp, path);
}

export async function generateKeyPair(): Promise<HubKeyPair> {
  const s = await getSodium();
  const kp = s.crypto_box_keypair();
  return { pk: b64e(kp.publicKey), sk: b64e(kp.privateKey) };
}

/** Load `hub.key`, or generate + persist a new keypair when missing/corrupt. */
export async function loadOrCreateKeyPair(path: string): Promise<HubKeyPair> {
  if (existsSync(path)) {
    try {
      const parsed = KeyFile.safeParse(JSON.parse(readFileSync(path, 'utf8')));
      if (parsed.success) return parsed.data;
    } catch {
      /* corrupt → regenerate */
    }
  }
  const kp = await generateKeyPair();
  writeSecretFile(path, JSON.stringify(kp));
  return kp;
}

/** crypto_box_seal_open(b64d(ciphertext)) → utf8 plaintext. Throws on wrong key / tampered data. */
export async function openSealed(ciphertextB64: string, kp: HubKeyPair): Promise<string> {
  const s = await getSodium();
  const out = s.crypto_box_seal_open(b64d(ciphertextB64), b64d(kp.pk), b64d(kp.sk));
  return new TextDecoder().decode(out);
}

export function deleteKeyPair(path: string): boolean {
  if (!existsSync(path)) return false;
  rmSync(path, { force: true });
  return true;
}
