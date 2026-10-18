import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Room, Site } from "@devicenet/shared";
import { configStore } from "@/stores/config";
import { convertTimestamps } from "./ConfigSource";
import { FirestoreConfigSource, type SnapshotAdapter, type RawDoc } from "./cloud/FirestoreConfigSource";
import { LanConfigSource } from "./lan/LanConfigSource";
import { devicePresentationPatch, hubRenamePatch, roomDoc, siteDoc } from "./writes";

const ULID = "01HZX3K5M7Q9R2S4T6V8WABCDE";
const ts = (ms: number) => ({ toMillis: () => ms });

beforeEach(() => configStore.getState().reset());

describe("convertTimestamps", () => {
  it("converts nested Timestamps", () => {
    expect(convertTimestamps({ a: ts(1), b: [{ c: ts(2) }] })).toEqual({ a: 1, b: [{ c: 2 }] });
  });
});

describe("FirestoreConfigSource", () => {
  function fake() {
    const subs = new Map<string, (d: RawDoc[], m: { fromCache: boolean }) => void>();
    const unsubbed: string[] = [];
    const adapter: SnapshotAdapter = {
      onCollection(path, next) {
        const k = path.join("/");
        subs.set(k, next);
        return () => unsubbed.push(k);
      },
    };
    return { adapter, subs, unsubbed };
  }
  it("skips bad docs, converts Timestamps, subscribes rooms per site, resolves ready", async () => {
    const f = fake();
    const src = new FirestoreConfigSource(f.adapter);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    src.start("tenant_" + ULID);
    await Promise.resolve();
    await Promise.resolve();
    const t = "tenants/tenant_" + ULID;
    const sid = "site_" + ULID;
    f.subs.get(`${t}/sites`)!(
      [
        { id: sid, data: { name: "Nhà", timezone: "Asia/Ho_Chi_Minh", order: 0, createdAt: ts(5) } },
        { id: "bad", data: { name: "" } },
      ],
      { fromCache: true },
    );
    expect(configStore.getState().sites).toHaveLength(1);
    expect(configStore.getState().sites[0]!.createdAt).toBe(5);
    expect(warn).toHaveBeenCalled();
    expect(f.subs.has(`${t}/sites/${sid}/rooms`)).toBe(true);
    f.subs.get(`${t}/hubs`)!([], { fromCache: false });
    f.subs.get(`${t}/devices`)!([], { fromCache: false });
    await src.ready;
    expect(configStore.getState().loaded.devices).toBe(true);
    f.subs.get(`${t}/sites`)!([], { fromCache: false });
    expect(f.unsubbed).toContain(`${t}/sites/${sid}/rooms`);
    src.stop();
    warn.mockRestore();
  });
});

describe("LanConfigSource", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());
  it("polls with ETag, 304 no-op, every 30 s", async () => {
    const body = {
      tenantId: "tenant_" + ULID,
      hubId: "hub_" + ULID,
      site: { id: "site_" + ULID, name: "Nhà", timezone: "UTC", order: 0, createdAt: 1 },
      rooms: [{ id: "room_" + ULID, name: "Khách", order: 0 }],
      devices: [],
      scenes: [],
      rules: [],
      layout: null,
      cachedAt: 1,
    };
    const calls: Array<Record<string, string> | undefined> = [];
    const fetchImpl = vi.fn(async (u: string, init?: RequestInit) => {
      if (u.endsWith("/api/events")) return new Response("[]", { status: 200 });
      calls.push(init?.headers as Record<string, string>);
      if (calls.length === 1) return new Response(JSON.stringify(body), { status: 200, headers: { ETag: '"v1"' } });
      return new Response(null, { status: 304 });
    }) as unknown as typeof fetch;
    const src = new LanConfigSource("", fetchImpl);
    src.start();
    await src.ready;
    expect(src.tenantId).toBe(body.tenantId);
    expect(src.hubId).toBe(body.hubId);
    expect(configStore.getState().sites).toHaveLength(1);
    expect(configStore.getState().roomsBySite[body.site.id as never]).toHaveLength(1);
    const before = configStore.getState().sites;
    await vi.advanceTimersByTimeAsync(30_000);
    expect(calls).toHaveLength(2);
    expect(calls[1]).toEqual({ "If-None-Match": '"v1"' });
    expect(configStore.getState().sites).toBe(before);
    src.stop();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(calls).toHaveLength(2);
  });
});

describe("writes", () => {
  it("device patch only contains rule-allowed keys", () => {
    const allowed = ["name", "roomId", "icon", "primaryProperty", "toggleProperty", "status", "updatedAt", "properties"];
    const p = devicePresentationPatch(
      { name: "Đèn", roomId: null, icon: "bulb", primaryProperty: "state", status: "active" },
      9,
    );
    expect(Object.keys(p).every((k) => allowed.includes(k))).toBe(true);
    expect(p.updatedAt).toBe(9);
  });
  it("room/site docs satisfy shared schemas; hub rename only name/siteId", () => {
    expect(Room.safeParse(roomDoc("Bếp", 1)).success).toBe(true);
    expect(roomDoc("x", 0).id).toMatch(/^room_[0-9A-HJKMNP-TV-Z]{26}$/);
    expect(Site.safeParse(siteDoc("Nhà", "Asia/Ho_Chi_Minh")).success).toBe(true);
    expect(Object.keys(hubRenamePatch("Hub", "site_x"))).toEqual(["name", "siteId"]);
    expect(Object.keys(hubRenamePatch("Hub"))).toEqual(["name"]);
  });
});
