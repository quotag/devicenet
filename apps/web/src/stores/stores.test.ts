import { beforeEach, describe, expect, it } from "vitest";
import type { DeviceId, DeviceState, HubId, TenantId } from "@devicenet/shared";
import {
  configStore,
  connectionStore,
  deviceStateStore,
  display,
  hubOnline,
  isPending,
  resetAll,
  sessionStore,
  toastStore,
  uiStore,
} from "./index";

const dev = "dev_01HZZZZZZZZZZZZZZZZZZZZZZZ" as DeviceId;
const hub = "hub_01HZZZZZZZZZZZZZZZZZZZZZZZ" as HubId;

beforeEach(() => resetAll());

describe("stores", () => {
  it("session transitions and reset keeps mode", () => {
    const s = sessionStore.getState();
    s.setMode("lan");
    s.setStatus("ready");
    s.setTenantId("tenant_01HZZZZZZZZZZZZZZZZZZZZZZZ" as TenantId);
    s.setIdToken("tok");
    resetAll();
    const after = sessionStore.getState();
    expect(after.status).toBe("signedOut");
    expect(after.tenantId).toBeNull();
    expect(after.idToken).toBeNull();
    expect(after.mode).toBe("lan");
  });

  it("deviceState: pending overrides confirmed, removal works", () => {
    const st = { values: { on: false } } as unknown as DeviceState;
    deviceStateStore.getState().setState(dev, st);
    expect(display(deviceStateStore.getState(), dev, "on")).toBe(false);
    deviceStateStore.getState().setPending({ [dev]: { on: { value: true, sentAt: 1 } } });
    const s = deviceStateStore.getState();
    expect(display(s, dev, "on")).toBe(true);
    expect(isPending(s, dev, "on")).toBe(true);
    expect(isPending(s, dev, "other")).toBe(false);
    deviceStateStore.getState().removeState(dev);
    expect(deviceStateStore.getState().byId[dev]).toBeUndefined();
  });

  it("connection: hubOnline falls back to mirror; pairing null removes", () => {
    expect(hubOnline(hub, true)).toBe(true);
    expect(hubOnline(hub)).toBe(false);
    connectionStore.getState().setHubStatus(hub, { online: false } as never);
    expect(hubOnline(hub, true)).toBe(false);
    connectionStore.getState().setPairing(hub, { active: true } as never);
    connectionStore.getState().setPairing(hub, null);
    expect(connectionStore.getState().pairing[hub]).toBeUndefined();
  });

  it("config: sites sorted by order; reset clears", () => {
    configStore.getState().setSites([{ order: 2, id: "b" }, { order: 1, id: "a" }] as never);
    expect(configStore.getState().sites.map((x) => (x as { id: string }).id)).toEqual(["a", "b"]);
    configStore.getState().setLoaded("sites");
    expect(configStore.getState().loaded.sites).toBe(true);
    resetAll();
    expect(configStore.getState().sites).toEqual([]);
    expect(configStore.getState().loaded).toEqual({});
  });

  it("ui: filter resets on site change; sheet open/close", () => {
    uiStore.getState().setFilter("room_x" as never);
    uiStore.getState().setSiteId("site_x" as never);
    expect(uiStore.getState().filter).toBe("all");
    uiStore.getState().openSheet({ kind: "sh2", ctx: "home" });
    expect(uiStore.getState().sheet).toEqual({ kind: "sh2", ctx: "home" });
    uiStore.getState().closeSheet();
    expect(uiStore.getState().sheet).toBeNull();
  });

  it("toast shows one at a time", () => {
    toastStore.getState().show({ kind: "error", text: "a" });
    toastStore.getState().show({ kind: "timeout", text: "b" });
    expect(toastStore.getState().current?.text).toBe("b");
    resetAll();
    expect(toastStore.getState().current).toBeNull();
  });
});
