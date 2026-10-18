import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { initializeApp, deleteApp, type FirebaseApp } from 'firebase/app';
import { connectAuthEmulator, getAuth, signInWithCustomToken } from 'firebase/auth';
import { connectFirestoreEmulator, doc, getDoc, getFirestore, setDoc, terminate, updateDoc, type Firestore } from 'firebase/firestore';
import type { Device } from '@devicenet/shared';
import type { HubCredential } from '../../src/claim/credentials.js';
import { clearProxyEnv, FirestoreConfigStore, EVENT_TTL_MS } from '../../src/sync/firestoreStore.js';
import { EventUploader } from '../../src/sync/eventUploader.js';
import { Registry } from '../../src/core/registry.js';
import { openStore } from '../../src/store/index.js';
import { Reconciler } from '../../src/sync/reconciler.js';
import { IDENTITY, makeDevice } from '../core/helpers.js';
import { until } from '../core/helpers.js';

clearProxyEnv();

/** The Auth emulator accepts unsigned custom tokens (alg none), same claims shape as the api mints with the Admin SDK. */
function customToken(uid: string, claims: Record<string, unknown>): string {
  const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const now = Math.floor(Date.now() / 1000);
  return (
    b64({ alg: 'none', typ: 'JWT' }) +
    '.' +
    b64({
      iss: 'firebase-auth-emulator@example.com',
      sub: 'firebase-auth-emulator@example.com',
      aud: 'https://identitytoolkit.googleapis.com/google.identity.identitytoolkit.v1.IdentityToolkit',
      iat: now,
      exp: now + 3600,
      uid,
      claims,
    }) +
    '.'
  );
}

const { tenantId, hubId, siteId } = IDENTITY;
const cred = (token: string): HubCredential => ({
  tenantId,
  hubId,
  siteId,
  mqtt: { host: '127.0.0.1', port: 1883, wssPort: 9001, username: `hub:${hubId}`, password: 'x' },
  firebaseCustomToken: token,
  apiBaseUrl: 'http://127.0.0.1:3000',
});
const hubToken = customToken(hubId, { tenant: tenantId, hubId, role: 'hub' });

let userApp: FirebaseApp;
let userDb: Firestore;
let hub: FirestoreConfigStore;
let refreshed = 0;

beforeAll(async () => {
  userApp = initializeApp({ projectId: 'demo-devicenet', apiKey: 'k' }, 'user');
  connectAuthEmulator(getAuth(userApp), 'http://127.0.0.1:9099', { disableWarnings: true });
  userDb = getFirestore(userApp);
  connectFirestoreEmulator(userDb, '127.0.0.1', 8085);
  await signInWithCustomToken(getAuth(userApp), customToken('uid-user', { tenant: tenantId, role: 'owner' }));
  await setDoc(doc(userDb, 'tenants', tenantId, 'sites', siteId), { id: siteId, name: 'Nhà', timezone: 'Asia/Ho_Chi_Minh', order: 0, createdAt: 1 });

  hub = new FirestoreConfigStore({
    credentialsPath: 'unused',
    credential: cred('garbage-token'), // OQ-5: first sign-in fails, refresh supplies a good one
    emulator: true,
    refresh: async () => {
      refreshed++;
      return cred(hubToken);
    },
  });
  await hub.connect();
});

afterAll(async () => {
  await hub?.close();
  await terminate(userDb).catch(() => {});
  await deleteApp(userApp).catch(() => {});
});

describe('FirestoreConfigStore against emulators', () => {
  it('refreshed the token after the failed custom-token sign-in (OQ-5)', () => {
    expect(refreshed).toBe(1);
    expect(hub.signInState).toBe('signed-in');
  });

  it('creates a device, updates hub fields, and sees user-field changes via listener', async () => {
    const db = openStore(':memory:');
    const registry = new Registry({ repo: db.devices });
    const dev = makeDevice({ status: 'new' });
    registry.insert(dev, { synced: false });
    const rec = new Reconciler({ store: hub, registry, db, firstSnapshotTimeoutMs: 5000 });
    rec.start();
    const r = await rec.reconcile();
    expect(r.devices).toBe(1);
    const path = doc(userDb, 'tenants', tenantId, 'devices', dev.id);
    expect((await getDoc(path)).data()).toMatchObject({ status: 'new', hubId });

    // hub-field update
    await hub.updateDeviceHubFields(dev.id, { firmware: '9.9', updatedAt: 5 });
    expect((await getDoc(path)).data()).toMatchObject({ firmware: '9.9' });

    // user renames + activates -> registry
    await updateDoc(path, { name: 'Đèn bàn', status: 'active', updatedAt: 6 });
    await until(() => registry.get(dev.id)!.device.name === 'Đèn bàn', 8000);
    expect(registry.get(dev.id)!.device.status).toBe('active');
    expect(db.snapshot.get<Device[]>('devices')!.json.some((d) => d.name === 'Đèn bàn')).toBe(true);

    // site listener caches the site
    await until(() => rec.deviceSync.site?.name === 'Nhà', 8000);
    expect(db.snapshot.get('site')).toBeTruthy();
    rec.stop();
  });

  it('hub cannot change user fields (rules apply: client SDK, not Admin)', async () => {
    const dev = makeDevice({ status: 'new' });
    await hub.createDevice(dev);
    await expect(hub.updateDeviceHubFields(dev.id, { ...({ name: 'hack' } as object) })).rejects.toMatchObject({ code: 'permission-denied' });
  });

  it('uploads events with Timestamp expireAt; duplicate upload tolerated (OQ-4, OQ-9)', async () => {
    const db = openStore(':memory:');
    const ev = { v: 1, ts: 1_700_000_000_000, seq: 1, id: 'evt_emu1', hubId, type: 'hub.warning', code: 'x', message: 'm' } as never;
    db.events.insert(ev);
    const up = new EventUploader({ store: () => hub, repo: db.events });
    expect(await up.flush()).toBe(1);
    const snap = await getDoc(doc(userDb, 'tenants', tenantId, 'events', 'evt_emu1'));
    const data = snap.data()!;
    expect(data.expireAt.toMillis()).toBe(1_700_000_000_000 + EVENT_TTL_MS);
    expect(data.type).toBe('hub.warning');

    // duplicate: pretend the mark was lost
    (db.db as unknown as { prepare(s: string): { run(): void } }).prepare('UPDATE events SET uploaded = 0').run();
    expect(await up.flush()).toBe(1);
    expect(db.events.pendingUpload()).toHaveLength(0);
  });
});
