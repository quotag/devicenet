import { db } from '../firebase.js';
import { kickClient } from './emqxAdmin.js';
import { clearHubCache } from './hubCache.js';

/**
 * Cascade deletion of a hub:
 * 1. (a) Delete private/secret and clear hub cache to revoke credentials immediately.
 * 2. (b) Kick live EMQX MQTT connection (best-effort).
 * 3. (c) Hard-delete all device documents belonging to this hub (and associated events).
 * 4. (d) Mark associated rules and scenes as broken.
 * 5. (e) Delete the hub document LAST so retries on failure can detect and complete the deletion.
 * All operations are committed in batches of <= 400 and are idempotent.
 */
export async function deleteHubCascade(
  tenantId: string,
  hubId: string,
  log?: { warn: (o: unknown, m?: string) => void },
): Promise<void> {
  const fs = db();
  const hubRef = fs.doc(`tenants/${tenantId}/hubs/${hubId}`);

  // (a) Revoke credentials immediately
  await hubRef.collection('private').doc('secret').delete().catch(() => {});
  clearHubCache(hubId);

  // (b) Drop live MQTT connection
  await kickClient(`hub-${hubId}`, log);

  // (c) Query devices, rules, scenes, and events
  const [devices, rules, scenes, events] = await Promise.all([
    fs.collection(`tenants/${tenantId}/devices`).where('hubId', '==', hubId).get(),
    fs.collection(`tenants/${tenantId}/rules`).where('hubId', '==', hubId).get(),
    fs.collection(`tenants/${tenantId}/scenes`).where('hubId', '==', hubId).get(),
    fs.collection(`tenants/${tenantId}/events`).where('hubId', '==', hubId).get().catch(() => null),
  ]);

  const ops: Array<(b: FirebaseFirestore.WriteBatch) => void> = [];

  // (c) Hard-delete all devices of this hub
  for (const d of devices.docs) {
    ops.push((b) => b.delete(d.ref));
  }

  // Delete hub events
  if (events) {
    for (const e of events.docs) {
      ops.push((b) => b.delete(e.ref));
    }
  }

  // (d) Mark rules and scenes as broken
  for (const d of [...rules.docs, ...scenes.docs]) {
    ops.push((b) => b.update(d.ref, { lastResult: 'broken', brokenReason: 'Hub đã bị xóa' }));
  }

  // (e) Delete hub document last
  ops.push((b) => b.delete(hubRef));

  for (let i = 0; i < ops.length; i += 400) {
    const b = fs.batch();
    for (const op of ops.slice(i, i + 400)) op(b);
    await b.commit();
  }
}
