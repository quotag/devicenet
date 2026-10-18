import { sha256Hex } from '../auth/hubAuth.js';
import { db } from '../firebase.js';

const TTL_MS = 60_000;
export const HUB_USERNAME_RE = /^hub:(hub_[0-9A-Z]{26})$/;

interface Entry {
  tenant: string;
  exp: number;
}
const authCache = new Map<string, Entry>(); // `${hubId}:${hash}` -> tenant
const existsCache = new Map<string, number>(); // `${tenant}/${hubId}` -> exp

export function clearHubCache(hubId?: string) {
  if (!hubId) {
    authCache.clear();
    existsCache.clear();
    return;
  }
  for (const k of authCache.keys()) if (k.startsWith(`${hubId}:`)) authCache.delete(k);
  for (const k of existsCache.keys()) if (k.endsWith(`/${hubId}`)) existsCache.delete(k);
}

/** Returns the hub's tenant when sha256(password) matches its private/secret (cached 60 s). */
export async function verifyHubPassword(hubId: string, password: string): Promise<string | null> {
  const hash = sha256Hex(password);
  const key = `${hubId}:${hash}`;
  const hit = authCache.get(key);
  if (hit && hit.exp > Date.now()) return hit.tenant;
  authCache.delete(key);
  const snap = await db().collectionGroup('private').where('secretHash', '==', hash).get();
  for (const doc of snap.docs) {
    const hubRef = doc.ref.parent.parent;
    if (doc.id !== 'secret' || !hubRef || hubRef.id !== hubId) continue;
    const tenant = hubRef.parent.parent?.id;
    if (!tenant) continue;
    authCache.set(key, { tenant, exp: Date.now() + TTL_MS });
    return tenant;
  }
  return null;
}

/** True when tenants/{tenant}/hubs/{hubId}/private/secret exists (cached 60 s, positive only). */
export async function hubSecretExists(tenant: string, hubId: string): Promise<boolean> {
  const key = `${tenant}/${hubId}`;
  const exp = existsCache.get(key);
  if (exp && exp > Date.now()) return true;
  existsCache.delete(key);
  const s = await db().doc(`tenants/${tenant}/hubs/${hubId}/private/secret`).get();
  if (!s.exists) return false;
  existsCache.set(key, Date.now() + TTL_MS);
  return true;
}
