import { Device, EventDoc, Hub, Room, Rule, Scene, Site, type DeviceId, type HubId, type SiteId } from "@devicenet/shared";
import { configStore, type CollectionName } from "@/stores/config";
import { uiStore } from "@/stores/ui";
import { paths } from "@/lib/paths";
import { deferred, parseDocs, type ConfigSource } from "../ConfigSource";

export interface RawDoc {
  id: string;
  data: Record<string, unknown>;
}
/** Optional server-side ordering/limit (events: `ts desc`, 50). */
export interface CollectionQuery {
  orderByDesc?: string;
  limit?: number;
}
export interface SnapshotMeta {
  fromCache: boolean;
}
/** Thin seam over Firestore `onSnapshot` on a collection path (`includeMetadataChanges:false`). */
export interface SnapshotAdapter {
  onCollection(
    path: readonly string[],
    next: (docs: RawDoc[], meta: SnapshotMeta) => void,
    error: (e: unknown) => void,
    query?: CollectionQuery,
  ): () => void;
}

export async function createFirestoreAdapter(): Promise<SnapshotAdapter> {
  const [{ getDb }, fs] = await Promise.all([import("./firestore"), import("firebase/firestore")]);
  const db = getDb();
  return {
    onCollection(path, next, error, query) {
      const [first, ...rest] = path as [string, ...string[]];
      const col = fs.collection(db, first, ...rest);
      return fs.onSnapshot(
        query
          ? fs.query(
              col,
              ...(query.orderByDesc ? [fs.orderBy(query.orderByDesc, "desc")] : []),
              ...(query.limit ? [fs.limit(query.limit)] : []),
            )
          : col,
        { includeMetadataChanges: false },
        (snap) =>
          next(
            snap.docs.map((d) => ({ id: d.id, data: d.data() as Record<string, unknown> })),
            { fromCache: snap.metadata.fromCache },
          ),
        error,
      );
    },
  };
}

type Source = SnapshotAdapter | Promise<SnapshotAdapter>;

export class FirestoreConfigSource implements ConfigSource {
  private unsubs: Array<() => void> = [];
  private roomUnsubs = new Map<string, () => void>();
  private gen = 0;
  private d = deferred();
  private pendingColls = new Set<CollectionName>();
  private readonly source: Source | null;

  constructor(adapter?: Source) {
    this.source = adapter ?? null;
  }

  get ready(): Promise<void> {
    return this.d.promise;
  }

  start(tenantId: string): void {
    this.stop();
    const gen = ++this.gen;
    this.d = deferred();
    this.pendingColls = new Set(["sites", "hubs", "devices"]);
    void Promise.resolve(this.source ?? createFirestoreAdapter()).then((a) => {
      if (gen !== this.gen) return;
      this.subscribe(a, tenantId, gen);
    });
  }

  stop(): void {
    this.gen++;
    for (const u of this.unsubs) u();
    for (const u of this.roomUnsubs.values()) u();
    this.unsubs = [];
    this.roomUnsubs.clear();
  }

  private mark(c: CollectionName, fromCache: boolean): void {
    const st = configStore.getState();
    st.setLoaded(c);
    st.setFromCache(fromCache);
    this.pendingColls.delete(c);
    if (this.pendingColls.size === 0) this.d.resolve();
  }

  private onError = (label: string) => (e: unknown) => console.warn(`[config] ${label} listener error`, e);

  private subscribe(a: SnapshotAdapter, tenantId: string, gen: number): void {
    const withId = (docs: RawDoc[]) => docs.map((d) => ({ id: d.id, ...d.data }));

    this.unsubs.push(
      a.onCollection(
        paths.sites(tenantId),
        (docs, meta) => {
          if (gen !== this.gen) return;
          const sites = parseDocs(Site, withId(docs), "site");
          configStore.getState().setSites(sites);
          const currentUiSite = uiStore.getState().siteId;
          if (sites.length > 0 && (!currentUiSite || !sites.some((s) => s.id === currentUiSite))) {
            uiStore.getState().setSiteId(sites[0].id);
          }
          this.syncRooms(a, tenantId, sites.map((s) => s.id), gen);
          this.mark("sites", meta.fromCache);
        },
        this.onError("sites"),
      ),
      a.onCollection(
        paths.hubs(tenantId),
        (docs, meta) => {
          if (gen !== this.gen) return;
          const map: Record<HubId, ReturnType<typeof Hub.parse>> = {};
          for (const h of parseDocs(Hub, withId(docs), "hub")) map[h.id as HubId] = h;
          configStore.getState().setHubs(map);
          this.mark("hubs", meta.fromCache);
        },
        this.onError("hubs"),
      ),
      a.onCollection(
        paths.devices(tenantId),
        (docs, meta) => {
          if (gen !== this.gen) return;
          const map: Record<DeviceId, Device> = {};
          for (const dv of parseDocs(Device, withId(docs), "device")) map[dv.id as DeviceId] = dv;
          configStore.getState().setDevices(map);
          this.mark("devices", meta.fromCache);
        },
        this.onError("devices"),
      ),
      a.onCollection(
        paths.rules(tenantId),
        (docs, meta) => {
          if (gen !== this.gen) return;
          const map: Record<string, Rule> = {};
          for (const r of parseDocs(Rule, withId(docs), "rule")) map[r.id] = r;
          configStore.getState().setRules(map);
          this.mark("rules", meta.fromCache);
        },
        this.onError("rules"),
      ),
      a.onCollection(
        paths.scenes(tenantId),
        (docs, meta) => {
          if (gen !== this.gen) return;
          const map: Record<string, Scene> = {};
          for (const sc of parseDocs(Scene, withId(docs), "scene")) map[sc.id] = sc;
          configStore.getState().setScenes(map);
          this.mark("scenes", meta.fromCache);
        },
        this.onError("scenes"),
      ),
      // T116: `parseDocs` converts Firestore Timestamps (hub-written `expireAt`) to epoch ms before `EventDoc.parse`.
      a.onCollection(
        paths.events(tenantId),
        (docs) => {
          if (gen !== this.gen) return;
          const events = parseDocs(EventDoc, withId(docs), "event").sort((x, y) => y.ts - x.ts);
          configStore.getState().setEvents(events);
          configStore.getState().setLoaded("events");
        },
        this.onError("events"),
        { orderByDesc: "ts", limit: 50 },
      ),
    );
  }

  /** Re-subscribe rooms when the set of sites changes. */
  private syncRooms(a: SnapshotAdapter, tenantId: string, siteIds: SiteId[], gen: number): void {
    const want = new Set<string>(siteIds);
    for (const [id, u] of this.roomUnsubs) {
      if (!want.has(id)) {
        u();
        this.roomUnsubs.delete(id);
      }
    }
    for (const id of siteIds) {
      if (this.roomUnsubs.has(id)) continue;
      this.roomUnsubs.set(
        id,
        a.onCollection(
          paths.rooms(tenantId, id),
          (docs) => {
            if (gen !== this.gen) return;
            const rooms = parseDocs(Room, docs.map((d) => ({ id: d.id, ...d.data })), "room");
            configStore.getState().setRooms(id, rooms.sort((x, y) => x.order - y.order));
            configStore.getState().setLoaded("rooms");
          },
          this.onError("rooms"),
        ),
      );
    }
  }
}
