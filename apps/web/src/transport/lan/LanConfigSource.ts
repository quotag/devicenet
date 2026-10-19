import { Device, EventDoc, Hub, Layout, Room, Rule, Scene, Site, type DeviceId, type HubId } from "@devicenet/shared";
import { configStore } from "@/stores/config";
import { deferred, parseDoc, parseDocs, type ConfigSource } from "../ConfigSource";

export const LAN_POLL_MS = 30_000;

interface LanConfig {
  tenantId: string;
  hubId: string;
  site: unknown;
  rooms: unknown[];
  devices: unknown[];
  scenes: unknown[];
  rules: unknown[];
  layout: unknown;
  hub?: unknown;
  cachedAt: number;
}

export class LanConfigSource implements ConfigSource {
  tenantId: string | null = null;
  hubId: string | null = null;
  private etag: string | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private d = deferred();
  private resolved = false;
  private onVis = () => {
    if (typeof document !== "undefined" && document.visibilityState === "visible") void this.poll();
  };

  constructor(
    private baseUrl = "",
    private fetchImpl: typeof fetch = (...a) => fetch(...a),
  ) {}

  get ready(): Promise<void> {
    return this.d.promise;
  }

  start(_tenantId?: string): void {
    this.stop();
    this.d = deferred();
    this.resolved = false;
    void this.poll();
    this.timer = setInterval(() => void this.poll(), LAN_POLL_MS);
    if (typeof document !== "undefined") document.addEventListener("visibilitychange", this.onVis);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    if (typeof document !== "undefined") document.removeEventListener("visibilitychange", this.onVis);
  }

  async poll(): Promise<void> {
    try {
      const headers: Record<string, string> = {};
      if (this.etag) headers["If-None-Match"] = this.etag;
      const res = await this.fetchImpl(`${this.baseUrl}/api/config`, { headers });
      if (res.status === 304) {
        this.markReady();
        void this.pollEvents();
        return;
      }
      if (!res.ok) throw new Error(`GET /api/config ${res.status}`);
      this.etag = res.headers.get("ETag");
      this.apply((await res.json()) as LanConfig);
      this.markReady();
      void this.pollEvents();
    } catch (e) {
      console.warn("[config] LAN poll failed", e);
    }
  }

  /** `GET /api/events` (non-fatal): newest 50 into the config store. */
  async pollEvents(): Promise<void> {
    try {
      const res = await this.fetchImpl(`${this.baseUrl}/api/events`);
      if (!res.ok) return;
      const body = (await res.json()) as unknown;
      const list = Array.isArray(body) ? body : ((body as { events?: unknown[] } | null)?.events ?? []);
      const events = parseDocs(EventDoc, list, "event").sort((a, b) => b.ts - a.ts).slice(0, 50);
      configStore.getState().setEvents(events);
      configStore.getState().setLoaded("events");
    } catch (e) {
      console.warn("[config] LAN events poll failed", e);
    }
  }

  private markReady(): void {
    if (this.resolved) return;
    this.resolved = true;
    this.d.resolve();
  }

  private apply(c: LanConfig): void {
    this.tenantId = c.tenantId;
    this.hubId = c.hubId;
    const st = configStore.getState();
    const site = parseDoc(Site, c.site, "site");
    st.setSites(site ? [site] : []);
    if (site) st.setRooms(site.id, parseDocs(Room, c.rooms ?? [], "room").sort((a, b) => a.order - b.order));
    const devices: Record<DeviceId, Device> = {};
    for (const d of parseDocs(Device, c.devices ?? [], "device")) devices[d.id as DeviceId] = d;
    st.setDevices(devices);
    const hub = c.hub ? parseDoc(Hub, c.hub, "hub") : undefined;
    if (hub) st.setHubs({ [hub.id]: hub } as Record<HubId, typeof hub>);
    const scenes: Record<string, Scene> = {};
    for (const s of parseDocs(Scene, c.scenes ?? [], "scene")) scenes[s.id] = s;
    st.setScenes(scenes);
    const rules: Record<string, Rule> = {};
    for (const r of parseDocs(Rule, c.rules ?? [], "rule")) rules[r.id] = r;
    st.setRules(rules);
    const layout = c.layout ? parseDoc(Layout, c.layout, "layout") : undefined;
    st.setLayouts(layout ? { [layout.siteId]: layout } : {});
    for (const k of ["sites", "rooms", "devices", "hubs", "scenes", "rules", "layouts"] as const) st.setLoaded(k);
    st.setFromCache(false);
  }
}
