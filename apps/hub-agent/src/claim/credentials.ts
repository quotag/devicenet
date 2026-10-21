import { existsSync, readFileSync, rmSync } from 'node:fs';
import { HubId, SiteId, TenantId } from '@devicenet/shared';
import { z } from 'zod';
import { writeSecretFile } from './keys.js';

/**
 * Local mirror of the decrypted claim credential (api.openapi.yaml
 * `/v1/hubs/claim-codes/{code}/credential` description). Stored as `credentials.json` 0600.
 * `mqtt.password` is the hub secret (also used for `Authorization: Hub <hubId>:<secret>`).
 */
export const HubCredential = z.object({
  tenantId: TenantId,
  hubId: HubId,
  siteId: SiteId,
  mqtt: z.object({
    host: z.string().min(1),
    port: z.number().int().min(1).max(65535),
    wssPort: z.number().int().min(1).max(65535),
    username: z.string().min(1),
    password: z.string().min(1),
  }),
  firebaseCustomToken: z.string().min(1),
  apiBaseUrl: z.string().url(),
  firebase: z
    .object({
      projectId: z.string().min(1),
      apiKey: z.string().min(1),
    })
    .optional(),
});
export type HubCredential = z.infer<typeof HubCredential>;

/** Read + validate `credentials.json`; null when missing. Throws when present but invalid. */
export function readCredentials(path: string): HubCredential | null {
  if (!existsSync(path)) return null;
  const res = HubCredential.safeParse(JSON.parse(readFileSync(path, 'utf8')));
  if (!res.success) throw new Error(`invalid ${path}: ${res.error.issues.map((i) => i.path.join('.')).join(', ')}`);
  return res.data;
}

export function writeCredentials(path: string, cred: HubCredential): void {
  writeSecretFile(path, JSON.stringify(HubCredential.parse(cred), null, 2));
}

/** Persist a refreshed Firebase custom token (OQ-5); returns the updated credential. */
export function updateToken(path: string, firebaseCustomToken: string): HubCredential {
  const cur = readCredentials(path);
  if (!cur) throw new Error(`no credentials at ${path}`);
  const next = { ...cur, firebaseCustomToken };
  writeCredentials(path, next);
  return next;
}

export function deleteCredentials(path: string): boolean {
  if (!existsSync(path)) return false;
  rmSync(path, { force: true });
  return true;
}
