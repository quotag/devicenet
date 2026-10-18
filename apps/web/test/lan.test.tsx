import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { RouterProvider, createMemoryHistory, createRootRoute, createRoute, createRouter } from "@tanstack/react-router";
import type { Device, DeviceId, DeviceState, HubId } from "@devicenet/shared";
import { resetAll, sessionStore } from "@/stores";
import { vi } from "@/i18n/vi";
import { TransportProvider } from "@/transport/TransportProvider";
import { useConfigWrites } from "@/transport/hooks";
import { HomeScreen } from "@/features/home/HomeScreen";
import { startLanSession } from "@/features/auth/session";
import { resolveRedirect } from "@/app/guards";
import { createFakeTransport } from "./fakeTransport";

const hubId = "hub_01HZZZZZZZZZZZZZZZZZZZZZZZ" as HubId;
const siteId = "site_01HZZZZZZZZZZZZZZZZZZZZZZZ";
const dev = {
  id: "dev_01HZZZZZZZZZZZZZZZZZZZZZZA" as DeviceId,
  hubId,
  siteId,
  roomId: null,
  driver: "zigbee2mqtt",
  externalId: "0xA",
  name: "Đèn A",
  icon: "plug",
  properties: { state: { key: "state", label: "Trạng thái", access: "rw", category: "control", type: "binary" } },
  status: "active",
  createdAt: 1,
  updatedAt: 1,
} as unknown as Device;
const st = {
  v: 1, ts: 1, seq: 1, deviceId: dev.id, online: true, lastSeen: Date.now(), values: { state: false }, at: { state: 1 },
} as DeviceState;

let writesSeen: unknown = "unset";
function Probe() {
  writesSeen = useConfigWrites();
  return null;
}

function mount() {
  const t = createFakeTransport({
    mode: "lan",
    sites: [{ id: siteId, name: "Nhà", timezone: "Asia/Ho_Chi_Minh", order: 0, createdAt: 1 }] as never,
    hubs: [{ id: hubId, name: "Hub", siteId, online: true }] as never,
    devices: [dev],
    states: [st],
    hubStatus: { [hubId]: { v: 1, ts: Date.now(), seq: 1, online: true } as never },
  });
  const root = createRootRoute({
    component: () => (
      <>
        <HomeScreen />
        <Probe />
      </>
    ),
  });
  const router = createRouter({
    routeTree: root.addChildren([createRoute({ getParentRoute: () => root, path: "/$x" })]),
    history: createMemoryHistory({ initialEntries: ["/home"] }),
  });
  render(
    <TransportProvider transport={t}>
      <RouterProvider router={router} />
    </TransportProvider>,
  );
  return t;
}

beforeEach(() => {
  resetAll();
  sessionStore.setState({ mode: "lan", status: "ready" });
});
afterEach(cleanup);

describe("LAN mode", () => {
  it("shows LAN banner, toggle works, config writes are null", async () => {
    const t = mount();
    expect(await screen.findByText(vi.banner.lanMode(location.hostname))).toBeInTheDocument();
    await act(async () => fireEvent.click(screen.getByRole("switch", { name: vi.dn2.turnOn("Đèn A") })));
    expect(t.sets).toEqual([{ deviceId: dev.id, values: { state: true } }]);
    expect(writesSeen).toBeNull();
  });

  it("guards keep LAN out of login/onboarding", () => {
    const base = { mode: "lan", status: "ready", hasHub: false } as const;
    expect(resolveRedirect({ ...base, pathname: "/login" })).toBe("/home");
    expect(resolveRedirect({ ...base, pathname: "/onboarding/hub" })).toBe("/home");
  });

  it("boot reads tenant from /api/config", async () => {
    sessionStore.setState({ mode: "cloud", status: "booting" });
    const f = (async () => new Response(JSON.stringify({ tenantId: "tenant_X", hubId }), { status: 200 })) as typeof fetch;
    await startLanSession(f);
    expect(sessionStore.getState()).toMatchObject({ mode: "lan", status: "ready", tenantId: "tenant_X" });
  });

});
