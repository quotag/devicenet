import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, beforeAll, afterAll, beforeEach } from 'vitest';
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, updateDoc, deleteDoc, addDoc, collection } from 'firebase/firestore';

const T1 = 'tenant_A';
const T2 = 'tenant_B';
const HUB = 'hub_1';
let env: RulesTestEnvironment;

beforeAll(async () => {
  const [host, port] = (process.env.FIRESTORE_EMULATOR_HOST ?? '127.0.0.1:8085').split(':');
  env = await initializeTestEnvironment({
    projectId: 'demo-devicenet-rules',
    firestore: {
      host,
      port: Number(port),
      rules: readFileSync(resolve(__dirname, '../../../../infra/firestore.rules'), 'utf8'),
    },
  });
});
afterAll(async () => {
  await env.cleanup();
});
beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (ctx) => {
    const d = ctx.firestore();
    await setDoc(doc(d, `tenants/${T1}`), { id: T1 });
    await setDoc(doc(d, `tenants/${T1}/members/u1`), { uid: 'u1', role: 'owner' });
    await setDoc(doc(d, `tenants/${T1}/hubs/${HUB}`), { id: HUB, name: 'Hub', siteId: 's1', online: false, lastSeen: 0 });
    await setDoc(doc(d, `tenants/${T1}/hubs/${HUB}/private/secret`), { secretHash: 'x' });
    await setDoc(doc(d, `tenants/${T1}/devices/dev_1`), {
      id: 'dev_1', hubId: HUB, name: 'Plug', status: 'active', roomId: null, properties: {},
    });
    await setDoc(doc(d, `tenants/${T1}/rules/rule_1`), { id: 'rule_1', hubId: HUB, name: 'R', rev: 1, enabled: true });
    await setDoc(doc(d, `tenants/${T1}/scenes/scn_1`), { id: 'scn_1', hubId: HUB, name: 'S', rev: 1 });
    await setDoc(doc(d, 'claimCodes/ABCD2345'), { code: 'ABCD2345' });
  });
});

const user = (tenant = T1, uid = 'u1') => env.authenticatedContext(uid, { tenant, role: 'user' }).firestore();
const hub = (tenant = T1, hubId = HUB) =>
  env.authenticatedContext(hubId, { tenant, hubId, role: 'hub' }).firestore();

describe('tenant isolation', () => {
  it('same-tenant user reads; other tenant and anonymous cannot', async () => {
    await assertSucceeds(getDoc(doc(user(), `tenants/${T1}/devices/dev_1`)));
    await assertFails(getDoc(doc(user(T2), `tenants/${T1}/devices/dev_1`)));
    await assertFails(getDoc(doc(user(T2), `tenants/${T1}`)));
    await assertFails(getDoc(doc(env.unauthenticatedContext().firestore(), `tenants/${T1}/devices/dev_1`)));
  });
  it('hub of another tenant cannot write', async () => {
    await assertFails(updateDoc(doc(hub(T2), `tenants/${T1}/devices/dev_1`), { model: 'x' }));
  });
  it('tenant and member docs are never client-created/written', async () => {
    await assertFails(updateDoc(doc(user(), `tenants/${T1}`), { name: 'x' }));
    await assertFails(setDoc(doc(user(), `tenants/${T1}/members/u2`), { uid: 'u2' }));
  });
});

describe('hub column', () => {
  it('hub updates only hub fields on hubs', async () => {
    await assertSucceeds(updateDoc(doc(hub(), `tenants/${T1}/hubs/${HUB}`), { online: true, lastSeen: 5 }));
    await assertFails(updateDoc(doc(hub(), `tenants/${T1}/hubs/${HUB}`), { name: 'renamed' }));
    await assertFails(updateDoc(doc(hub(T1, 'hub_other'), `tenants/${T1}/hubs/${HUB}`), { online: true }));
  });
  it('hub updates only hub fields on devices', async () => {
    await assertSucceeds(updateDoc(doc(hub(), `tenants/${T1}/devices/dev_1`), { properties: { a: 1 }, updatedAt: 1 }));
    await assertFails(updateDoc(doc(hub(), `tenants/${T1}/devices/dev_1`), { name: 'x' }));
    await assertFails(updateDoc(doc(hub(), `tenants/${T1}/devices/dev_1`), { roomId: 'room_1' }));
  });
  it('hub creates devices only for itself with status new', async () => {
    const d = (id: string, hubId: string, status: string) =>
      setDoc(doc(hub(), `tenants/${T1}/devices/${id}`), { id, hubId, status });
    await assertSucceeds(d('dev_2', HUB, 'new'));
    await assertFails(d('dev_3', 'hub_other', 'new'));
    await assertFails(d('dev_4', HUB, 'active'));
  });
  it('hub updates only run-result fields on rules and scenes', async () => {
    await assertSucceeds(updateDoc(doc(hub(), `tenants/${T1}/rules/rule_1`), { appliedRev: 1, lastRunAt: 2 }));
    await assertFails(updateDoc(doc(hub(), `tenants/${T1}/rules/rule_1`), { enabled: false }));
    await assertSucceeds(updateDoc(doc(hub(), `tenants/${T1}/scenes/scn_1`), { appliedRev: 1 }));
    await assertFails(updateDoc(doc(hub(), `tenants/${T1}/scenes/scn_1`), { name: 'x' }));
  });
  it('hub cannot touch private secret', async () => {
    await assertFails(getDoc(doc(hub(), `tenants/${T1}/hubs/${HUB}/private/secret`)));
    await assertFails(setDoc(doc(hub(), `tenants/${T1}/hubs/${HUB}/private/secret`), { secretHash: 'y' }));
  });
});

describe('user column', () => {
  it('user edits presentation fields but cannot set device status removed', async () => {
    await assertSucceeds(updateDoc(doc(user(), `tenants/${T1}/devices/dev_1`), { name: 'Den', roomId: 'room_1' }));
    await assertFails(updateDoc(doc(user(), `tenants/${T1}/devices/dev_1`), { status: 'removed' }));
    await assertFails(updateDoc(doc(user(), `tenants/${T1}/devices/dev_1`), { hubId: 'hub_x' }));
  });
  it('user may move device new -> active', async () => {
    await env.withSecurityRulesDisabled((c) =>
      updateDoc(doc(c.firestore(), `tenants/${T1}/devices/dev_1`), { status: 'new' }),
    );
    await assertSucceeds(updateDoc(doc(user(), `tenants/${T1}/devices/dev_1`), { status: 'active' }));
  });
  it('user cannot delete devices or read hub secret; may rename hub but not set online', async () => {
    await assertFails(deleteDoc(doc(user(), `tenants/${T1}/devices/dev_1`)));
    await assertFails(getDoc(doc(user(), `tenants/${T1}/hubs/${HUB}/private/secret`)));
    await assertSucceeds(updateDoc(doc(user(), `tenants/${T1}/hubs/${HUB}`), { name: 'Hub 2' }));
    await assertFails(updateDoc(doc(user(), `tenants/${T1}/hubs/${HUB}`), { online: true }));
  });
  it('user may update prefs but not role on own member doc', async () => {
    await assertSucceeds(updateDoc(doc(user(), `tenants/${T1}/members/u1`), { prefs: { language: 'vi' } }));
    await assertFails(updateDoc(doc(user(), `tenants/${T1}/members/u1`), { role: 'member' }));
  });
});

describe('events', () => {
  it('hub creates own events; nobody updates or deletes; user cannot create', async () => {
    await assertSucceeds(setDoc(doc(hub(), `tenants/${T1}/events/evt_1`), { id: 'evt_1', hubId: HUB }));
    await assertFails(setDoc(doc(hub(), `tenants/${T1}/events/evt_2`), { id: 'evt_2', hubId: 'hub_other' }));
    await assertFails(addDoc(collection(user(), `tenants/${T1}/events`), { hubId: HUB }));
    await assertFails(updateDoc(doc(hub(), `tenants/${T1}/events/evt_1`), { x: 1 }));
    await assertFails(deleteDoc(doc(hub(), `tenants/${T1}/events/evt_1`)));
    await assertSucceeds(getDoc(doc(user(), `tenants/${T1}/events/evt_1`)));
  });
});

describe('claimCodes', () => {
  it('denied for everyone', async () => {
    for (const d of [user(), hub(), env.unauthenticatedContext().firestore()]) {
      await assertFails(getDoc(doc(d, 'claimCodes/ABCD2345')));
      await assertFails(setDoc(doc(d, 'claimCodes/ZZZZ2345'), { code: 'x' }));
    }
  });
});
