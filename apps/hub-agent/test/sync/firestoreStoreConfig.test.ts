import { describe, it, expect, afterEach } from 'vitest';
import { getApps, deleteApp } from 'firebase/app';
import { FirestoreConfigStore } from '../../src/sync/firestoreStore.js';
import type { HubCredential } from '../../src/claim/credentials.js';

const baseCred: HubCredential = {
  tenantId: 'tenant_01J0000000000000000000000T',
  hubId: 'hub_01J0000000000000000000000H',
  siteId: 'site_01J0000000000000000000000S',
  mqtt: { host: '127.0.0.1', port: 1884, wssPort: 8084, username: 'u', password: 'p' },
  firebaseCustomToken: 'tok-xyz',
  apiBaseUrl: 'http://127.0.0.1:3000',
};

describe('FirestoreConfigStore project & apiKey initialization', () => {
  afterEach(async () => {
    delete process.env.DN_FIREBASE_PROJECT;
    delete process.env.DN_FIREBASE_API_KEY;
    for (const app of getApps()) {
      await deleteApp(app).catch(() => {});
    }
  });

  it('uses firebase config from credential when present', async () => {
    const cred: HubCredential = {
      ...baseCred,
      firebase: {
        projectId: 'prod-project-from-cred',
        apiKey: 'prod-api-key-from-cred',
      },
    };
    const store = new FirestoreConfigStore({
      credentialsPath: 'unused',
      credential: cred,
      emulator: false,
      appName: 'test-cred-fb',
    });
    const app = getApps().find((a) => a.name === 'test-cred-fb');
    expect(app?.options.projectId).toBe('prod-project-from-cred');
    expect(app?.options.apiKey).toBe('prod-api-key-from-cred');
    await store.close();
  });

  it('falls back to DN_FIREBASE_* env when credential.firebase is missing', async () => {
    process.env.DN_FIREBASE_PROJECT = 'env-project-id';
    process.env.DN_FIREBASE_API_KEY = 'env-api-key';

    const store = new FirestoreConfigStore({
      credentialsPath: 'unused',
      credential: baseCred,
      emulator: false,
      appName: 'test-env-fb',
    });
    const app = getApps().find((a) => a.name === 'test-env-fb');
    expect(app?.options.projectId).toBe('env-project-id');
    expect(app?.options.apiKey).toBe('env-api-key');
    await store.close();
  });

  it('falls back to demo values when emulator is true', async () => {
    const store = new FirestoreConfigStore({
      credentialsPath: 'unused',
      credential: baseCred,
      emulator: true,
      appName: 'test-emu-fb',
    });
    const app = getApps().find((a) => a.name === 'test-emu-fb');
    expect(app?.options.projectId).toBe('demo-devicenet');
    expect(app?.options.apiKey).toBe('demo-key');
    await store.close();
  });

  it('throws in production when both credential.firebase and env are missing', () => {
    expect(
      () =>
        new FirestoreConfigStore({
          credentialsPath: 'unused',
          credential: baseCred,
          emulator: false,
          appName: 'test-throw-fb',
        }),
    ).toThrow(/Missing Firebase projectId or apiKey/);
  });
});
