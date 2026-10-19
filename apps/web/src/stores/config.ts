import { createStore } from "zustand/vanilla";
import type { z } from "zod";
import type {
  Device,
  DeviceId,
  EventDoc,
  Hub,
  HubId,
  Layout,
  Room,
  Rule,
  Scene,
  Site,
  SiteId,
} from "@devicenet/shared";

type SiteDoc = z.infer<typeof Site>;
type RoomDoc = z.infer<typeof Room>;
type HubDoc = z.infer<typeof Hub>;
export type EventDocT = z.infer<typeof EventDoc>;

export type CollectionName = "sites" | "rooms" | "hubs" | "devices" | "rules" | "scenes" | "layouts" | "events";

export interface ConfigState {
  sites: SiteDoc[];
  roomsBySite: Record<SiteId, RoomDoc[]>;
  hubs: Record<HubId, HubDoc>;
  devices: Record<DeviceId, Device>;
  rules: Record<string, Rule>;
  scenes: Record<string, Scene>;
  layouts: Record<SiteId, Layout>;
  events: EventDocT[];
  loaded: Partial<Record<CollectionName, boolean>>;
  fromCache: boolean;
  setSites(v: SiteDoc[]): void;
  setRooms(siteId: SiteId, v: RoomDoc[]): void;
  setHubs(v: Record<HubId, HubDoc>): void;
  setDevices(v: Record<DeviceId, Device>): void;
  setRules(v: Record<string, Rule>): void;
  setScenes(v: Record<string, Scene>): void;
  setLayouts(v: Record<SiteId, Layout>): void;
  setEvents(v: EventDocT[]): void;
  addEvent(e: EventDocT): void;
  setLoaded(c: CollectionName, v?: boolean): void;
  setFromCache(v: boolean): void;
  reset(): void;
}

const initial = () => ({
  sites: [] as SiteDoc[],
  roomsBySite: {} as Record<SiteId, RoomDoc[]>,
  hubs: {} as Record<HubId, HubDoc>,
  devices: {} as Record<DeviceId, Device>,
  rules: {} as Record<string, Rule>,
  scenes: {} as Record<string, Scene>,
  layouts: {} as Record<SiteId, Layout>,
  events: [] as EventDocT[],
  loaded: {} as Partial<Record<CollectionName, boolean>>,
  fromCache: false,
});

export const configStore = createStore<ConfigState>((set) => ({
  ...initial(),
  setSites: (sites) => set({ sites: [...sites].sort((a, b) => a.order - b.order) }),
  setRooms: (siteId, v) => set((st) => ({ roomsBySite: { ...st.roomsBySite, [siteId]: v } })),
  setHubs: (hubs) => set({ hubs }),
  setDevices: (devices) => set({ devices }),
  setRules: (rules) => set({ rules }),
  setScenes: (scenes) => set({ scenes }),
  setLayouts: (layouts) => set({ layouts }),
  setEvents: (events) => set({ events }),
  addEvent: (e) =>
    set((st) => ({
      events: [e, ...st.events.filter((x) => x.id !== e.id)].sort((a, b) => b.ts - a.ts).slice(0, 50),
    })),
  setLoaded: (c, v = true) => set((st) => ({ loaded: { ...st.loaded, [c]: v } })),
  setFromCache: (fromCache) => set({ fromCache }),
  reset: () => set(initial()),
}));
