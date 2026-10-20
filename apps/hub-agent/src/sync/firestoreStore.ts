import { deleteApp, getApps, initializeApp, type FirebaseApp } from 'firebase/app';
import { connectAuthEmulator, initializeAuth, inMemoryPersistence, signInWithCustomToken, type Auth } from 'firebase/auth';
import {
  collection,
  connectFirestoreEmulator,
  doc,
  initializeFirestore,
  memoryLocalCache,
  onSnapshot,
  query,
  setDoc,
  Timestamp,
  updateDoc,
  where,
  terminate,
  writeBatch,
  type Firestore,
} from 'firebase/firestore';
import { Device as DeviceSchema, Rule as RuleSchema, Scene as SceneSchema, Room as RoomSchema, Site as SiteSchema } from '@devicenet/shared';
import type { Device, Rule, Scene } from '@devicenet/shared';
import { refreshHubToken } from '../claim/tokenRefresh.js';
import type { HubCredential } from '../claim/credentials.js';
import type {
  ConfigStore,
  DeviceHubFields,
  EventDoc,
  Room,
  RuleHubFields,
  SceneHubFields,
  SignInState,
  Site,
  Unsubscribe,
} from './ConfigStore.js';

export const EVENT_TTL_MS = 30 * 24 * 3600 * 1000;
export const EMULATOR_AUTH = { host: '127.0.0.1', port: 9099 };
export const EMULATOR_FIRESTORE = { host: '127.0.0.1', port: 8085 };

type Log = { warn(obj: object, msg?: string): void; info?(obj: object, msg?: string): void };

export interface FirestoreStoreOptions {
  credentialsPath: string;
  /** current credential (token is replaced after a refresh) */
  credential: HubCredential;
  projectId?: string;
  /** DN_EMULATOR=1 */
  emulator?: boolean;
  apiKey?: string;
  log?: Log;
  /** override token refresh (tests); default = B08 refreshHubToken */
  refresh?: () => Promise<HubCredential>;
  appName?: string;
}

/** Corporate HTTP proxies break gRPC/HTTP to local emulators. */
export function clearProxyEnv(): void {
  for (const k of ['http_proxy', 'https_proxy', 'HTTP_PROXY', 'HTTPS_PROXY', 'grpc_proxy', 'GRPC_PROXY']) delete process.env[k];
  process.env.no_proxy = '127.0.0.1,localhost';
  process.env.NO_PROXY = '127.0.0.1,localhost';
}

/** OQ-4: `expireAt` is a Firestore Timestamp (ts + 30d) so the TTL policy applies. */
export function eventToFirestore(e: EventDoc): Record<string, unknown> {
  return { ...e, expireAt: Timestamp.fromMillis(e.ts + EVENT_TTL_MS) };
}

export const isPermissionDenied = (e: unknown): boolean => {
  const code = (e as { code?: string } | null)?.code;
  return code === 'permission-denied' || code === 'firestore/permission-denied';
};

const clean = <T extends object>(o: T): T => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as T;

/** Firestore ConfigStore over the CLIENT SDK + custom token, so security rules apply (D-06). */
export class FirestoreConfigStore implements ConfigStore {
  private state: SignInState = 'signed-out';
  private stateListeners = new Set<(s: SignInState) => void>();
  private app: FirebaseApp;
  private auth: Auth;
  private db: Firestore;
  private cred: HubCredential;
  private readyResolve!: () => void;
  private ready = new Promise<void>((r) => (this.readyResolve = r));
  private closed = false;

  constructor(private readonly o: FirestoreStoreOptions) {
    this.cred = o.credential;
    const projectId = o.projectId ?? process.env.DN_FIREBASE_PROJECT ?? process.env.GCLOUD_PROJECT ?? 'demo-devicenet';
    if (o.emulator) clearProxyEnv();
    const name = o.appName ?? `hub-${this.cred.hubId}`;
    const existing = getApps().find((a) => a.name === name);
    this.app = existing ?? initializeApp({ projectId, apiKey: o.apiKey ?? process.env.DN_FIREBASE_API_KEY ?? 'demo-key' }, name);
    this.auth = initializeAuth(this.app, { persistence: inMemoryPersistence });
    this.db = initializeFirestore(this.app, { localCache: memoryLocalCache(), ignoreUndefinedProperties: true });
    if (o.emulator) {
      connectAuthEmulator(this.auth, `http://${EMULATOR_AUTH.host}:${EMULATOR_AUTH.port}`, { disableWarnings: true });
      connectFirestoreEmulator(this.db, EMULATOR_FIRESTORE.host, EMULATOR_FIRESTORE.port);
    }
  }

  get signInState(): SignInState {
    return this.state;
  }
  onSignInState(cb: (s: SignInState) => void): Unsubscribe {
    this.stateListeners.add(cb);
    return () => void this.stateListeners.delete(cb);
  }
  private setState(s: SignInState): void {
    if (this.state === s) return;
    this.state = s;
    for (const l of this.stateListeners) l(s);
  }

  /** Sign in; on ANY failure refresh the custom token once (OQ-5) and retry. */
  async connect(): Promise<void> {
    this.setState('signing-in');
    try {
      try {
        await signInWithCustomToken(this.auth, this.cred.firebaseCustomToken);
      } catch (e) {
        this.o.log?.warn({ err: (e as Error).message }, 'custom token sign-in failed; refreshing token');
        this.cred = await (this.o.refresh ?? (() => refreshHubToken({ credentialsPath: this.o.credentialsPath })))();
        await signInWithCustomToken(this.auth, this.cred.firebaseCustomToken);
      }
    } catch (e) {
      this.setState('error');
      throw e;
    }
    this.setState('signed-in');
    this.readyResolve();
  }

  async close(): Promise<void> {
    this.closed = true;
    this.setState('signed-out');
    await terminate(this.db).catch(() => {});
    await deleteApp(this.app).catch(() => {});
  }

  private col(name: string) {
    return collection(this.db, 'tenants', this.cred.tenantId, name);
  }
  private ref(name: string, id: string) {
    return doc(this.db, 'tenants', this.cred.tenantId, name, id);
  }

  async createDevice(device: Device): Promise<void> {
    await this.ready;
    await setDoc(this.ref('devices', device.id), clean(device));
  }
  async updateDeviceHubFields(id: string, patch: DeviceHubFields): Promise<void> {
    await this.ready;
    await updateDoc(this.ref('devices', id), clean(patch));
  }
  async putEvent(event: EventDoc): Promise<void> {
    await this.ready;
    await setDoc(this.ref('events', event.id), clean(eventToFirestore(event)));
  }
  async updateRuleHubFields(id: string, patch: RuleHubFields): Promise<void> {
    await this.ready;
    await updateDoc(this.ref('rules', id), clean(patch));
  }
  async updateSceneHubFields(id: string, patch: SceneHubFields): Promise<void> {
    await this.ready;
    await updateDoc(this.ref('scenes', id), clean(patch));
  }
  async batchHubFields(writes: Array<{ kind: 'rule' | 'scene'; id: string; patch: RuleHubFields | SceneHubFields }>): Promise<void> {
    await this.ready;
    for (let i = 0; i < writes.length; i += 400) {
      const b = writeBatch(this.db);
      for (const w of writes.slice(i, i + 400)) b.update(this.ref(w.kind === 'rule' ? 'rules' : 'scenes', w.id), clean(w.patch));
      await b.commit();
    }
  }

  /** Runs `start()` after sign-in; the returned unsubscribe works before and after that. */
  private subscribe(start: () => Unsubscribe): Unsubscribe {
    let unsub: Unsubscribe | undefined;
    let cancelled = false;
    void this.ready.then(() => {
      if (!cancelled && !this.closed) unsub = start();
    });
    return () => {
      cancelled = true;
      unsub?.();
    };
  }

  private listenList<T>(name: string, schema: { safeParse(v: unknown): { success: boolean; data?: unknown } }, cb: (items: T[]) => void): Unsubscribe {
    return this.subscribe(() =>
      onSnapshot(
        query(this.col(name), where('hubId', '==', this.cred.hubId)),
        (snap) => {
          const items: T[] = [];
          for (const d of snap.docs) {
            const r = schema.safeParse(d.data());
            if (r.success) items.push(r.data as T);
            else this.o.log?.warn({ coll: name, id: d.id }, 'invalid doc ignored');
          }
          cb(items);
        },
        (err) => this.o.log?.warn({ coll: name, err: err.message }, 'listener error'),
      ),
    );
  }

  onDevices(cb: (devices: Device[]) => void): Unsubscribe {
    return this.listenList<Device>('devices', DeviceSchema, cb);
  }
  onRules(cb: (rules: Rule[]) => void): Unsubscribe {
    return this.listenList<Rule>('rules', RuleSchema, cb);
  }
  onScenes(cb: (scenes: Scene[]) => void): Unsubscribe {
    return this.listenList<Scene>('scenes', SceneSchema, cb);
  }

  onSite(cb: (site: Site | null, rooms: Room[]) => void): Unsubscribe {
    return this.subscribe(() => {
      let site: Site | null = null;
      let rooms: Room[] = [];
      let haveSite = false;
      const emit = () => haveSite && cb(site, rooms);
      const siteRef = this.ref('sites', this.cred.siteId);
      const u1 = onSnapshot(
        siteRef,
        (snap) => {
          const r = snap.exists() ? SiteSchema.safeParse(snap.data()) : null;
          site = r?.success ? (r.data as Site) : null;
          haveSite = true;
          emit();
        },
        (err) => this.o.log?.warn({ err: err.message }, 'site listener error'),
      );
      const u2 = onSnapshot(
        collection(siteRef, 'rooms'),
        (snap) => {
          rooms = snap.docs.flatMap((d) => {
            const r = RoomSchema.safeParse(d.data());
            return r.success ? [r.data as Room] : [];
          });
          emit();
        },
        (err) => this.o.log?.warn({ err: err.message }, 'rooms listener error'),
      );
      return () => {
        u1();
        u2();
      };
    });
  }

  onHubDeleted(cb: () => void): Unsubscribe {
    return this.subscribe(() => {
      const hubRef = this.ref('hubs', this.cred.hubId);
      return onSnapshot(
        hubRef,
        (snap) => {
          if (!snap.exists()) {
            this.o.log?.warn({ hubId: this.cred.hubId }, 'hub document deleted on cloud');
            cb();
          }
        },
        (err) => {
          this.o.log?.warn({ err: err.message }, 'hub document listener error');
          const code = (err as unknown as { code?: string })?.code;
          if (code === 'permission-denied' || code === 'not-found') {
            cb();
          }
        },
      );
    });
  }
}
