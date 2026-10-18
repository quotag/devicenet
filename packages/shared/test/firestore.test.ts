import { describe, expect, it } from "vitest";
import * as S from "../src";
import { D, EVT, H, R, RULE, S as SITE, SCN, T, id, plugDevice } from "./fixtures";

const ok = (s: { safeParse: (v: unknown) => { success: boolean } }, v: unknown) => s.safeParse(v).success;
const now = 1_760_000_000_000;

describe("firestore docs", () => {
  it("re-exports Rule and Scene", () => { expect(S.Rule).toBeDefined(); expect(S.Scene).toBeDefined(); });
  it("Tenant", () => {
    expect(S.Tenant.parse({ id: T, name: "Nhà", ownerUid: "u1", createdAt: now }).plan).toBe("home");
    expect(ok(S.Tenant, { id: T, name: "", ownerUid: "u1", createdAt: now })).toBe(false);
  });
  it("Member", () => {
    const m = { uid: "u1", role: "owner", email: "a@b.vn", joinedAt: now, prefs: {} };
    expect(ok(S.Member, m)).toBe(true);
    expect(S.Member.parse(m).prefs?.language).toBe("vi");
    expect(ok(S.Member, { ...m, role: "guest" })).toBe(false);
    expect(ok(S.Member, { ...m, email: "bad" })).toBe(false);
  });
  it("Site", () => {
    const s = { id: SITE, name: "Nhà", timezone: "Asia/Ho_Chi_Minh", lat: 10.8, lng: 106.7, createdAt: now };
    expect(ok(S.Site, s)).toBe(true);
    expect(ok(S.Site, { ...s, lat: 100 })).toBe(false);
  });
  it("Room", () => {
    expect(ok(S.Room, { id: R, name: "Phòng khách" })).toBe(true);
    expect(ok(S.Room, { id: R, name: "" })).toBe(false);
  });
  it("Hub", () => {
    const hub = { id: H, siteId: SITE, name: "Hub", claimedAt: now, claimedBy: "u1", online: true, lastSeen: now };
    expect(S.Hub.parse(hub).drivers).toEqual(["zigbee2mqtt"]);
    expect(ok(S.Hub, { ...hub, lanUrl: "not a url" })).toBe(false);
  });
  it("HubSecret", () => {
    expect(ok(S.HubSecret, { secretHash: "abc", alg: "sha256", rotatedAt: now })).toBe(true);
    expect(ok(S.HubSecret, { secretHash: "abc", alg: "md5", rotatedAt: now })).toBe(false);
  });
  it("DeviceStatus", () => { expect(ok(S.DeviceStatus, "new")).toBe(true); expect(ok(S.DeviceStatus, "gone")).toBe(false); });
  it("Device (TS011F plug)", () => {
    expect(S.Device.parse(plugDevice).icon).toBe("plug");
    expect(ok(S.Device, { ...plugDevice, roomId: null })).toBe(true);
    expect(ok(S.Device, { ...plugDevice, driver: "zha" })).toBe(false);
    expect(ok(S.Device, { ...plugDevice, name: "" })).toBe(false);
  });
  it("TileRect", () => {
    expect(ok(S.TileRect, { x: 0, y: 0, w: 2, h: 1 })).toBe(true);
    expect(ok(S.TileRect, { x: 0, y: 0, w: 3, h: 1 })).toBe(false);
    expect(ok(S.TileRect, { x: 0, y: 0, w: 1, h: 2 })).toBe(false);
  });
  it("Layout", () => {
    const l = { siteId: SITE, rev: 1, updatedAt: now, filters: { all: { tiles: { [D]: { x: 0, y: 0, w: 1, h: 1 } } } } };
    expect(S.Layout.parse(l).filters.all!.cols).toBe(2);
    expect(ok(S.Layout, { ...l, filters: { all: { cols: 9, tiles: {} } } })).toBe(false);
    expect(ok(S.Layout, { ...l, filters: { all: { tiles: { notId: { x: 0, y: 0, w: 1, h: 1 } } } } })).toBe(false);
  });
  it("EventDoc", () => {
    expect(ok(S.EventDoc, { id: EVT, hubId: H, ts: now, type: "rule.fired", ruleId: RULE, sceneId: SCN, expireAt: now + 2_592_000_000 })).toBe(true);
    expect(ok(S.EventDoc, { id: EVT, hubId: H, ts: now, type: "x" })).toBe(false);
  });
  it("ClaimCode", () => {
    const c = { code: "ABCD2345", hubPubKey: "k", createdAt: now, expiresAt: now + 900_000, used: false };
    expect(ok(S.ClaimCode, c)).toBe(true);
    expect(ok(S.ClaimCode, { ...c, code: "ABCD0I01" })).toBe(false);
    expect(ok(S.ClaimCode, { ...c, tenantId: id("hub") })).toBe(false);
  });
});
