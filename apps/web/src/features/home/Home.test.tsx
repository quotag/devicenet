import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi as vitest } from "vitest";
import { RouterProvider, createMemoryHistory, createRootRoute, createRoute, createRouter } from "@tanstack/react-router";
import type { Device, DeviceId, DeviceState, HubId } from "@devicenet/shared";
import { configStore, deviceStateStore, resetAll, sessionStore, toastStore, uiStore } from "@/stores";
import { connectionStore } from "@/stores/connection";
import { Toast } from "@/components/dn/Toast";
import { vi } from "@/i18n/vi";
import { PendingTracker } from "@/transport/PendingTracker";
import { TransportProvider } from "@/transport/TransportProvider";
import { createFakeTransport } from "../../../test/fakeTransport";
import { SheetHost } from "@/app/SheetHost";
import { HomeScreen } from "./HomeScreen";

const hubId = "hub_01HZZZZZZZZZZZZZZZZZZZZZZZ" as HubId;
const siteId = "site_01HZZZZZZZZZZZZZZZZZZZZZZZ";
const dev = (n: string, name: string, status = "active"): Device =>
  ({
    id: `dev_01HZZZZZZZZZZZZZZZZZZZZZZ${n}`,
    hubId,
    siteId,
    roomId: null,
    driver: "zigbee2mqtt",
    externalId: `0x${n}`,
    name,
    icon: "plug",
    properties: { state: { key: "state", label: "Trạng thái", access: "rw", category: "control", type: "binary" } },
    status,
    createdAt: Number(n.charCodeAt(0)),
    updatedAt: 1,
  }) as unknown as Device;
const st = (d: Device, on: boolean): DeviceState =>
  ({ v: 1, ts: 1, seq: 1, deviceId: d.id, online: true, lastSeen: Date.now(), values: { state: on }, at: { state: 1 } }) as DeviceState;

const A = dev("A", "Đèn A");
const B = dev("B", "Đèn B");
const C = dev("C", "Đèn C");
const N = dev("N", "Mới", "new");
const site = { id: siteId, name: "Nhà", timezone: "Asia/Ho_Chi_Minh", order: 0, createdAt: 1 };
const hubDoc = { id: hubId, name: "Hub Nhà", siteId, online: true };

function mount(opts: Parameters<typeof createFakeTransport>[0] = {}) {
  const t = createFakeTransport({
    sites: [site] as never,
    hubs: [hubDoc] as never,
    devices: [A, B, C, N],
    states: [st(A, false), st(B, false), st(C, true)],
    hubStatus: { [hubId]: { v: 1, ts: Date.now(), seq: 1, online: true } as never },
    ...opts,
  });
  const root = createRootRoute({
    component: () => (
      <>
        <HomeScreen />
        <SheetHost />
        <Toast />
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
  sessionStore.setState({ mode: "cloud", status: "ready" });
});
afterEach(() => {
  cleanup();
  vitest.useRealTimers();
});

describe("Home", () => {
  it("shows active devices only (status new hidden)", async () => {
    mount();
    expect(await screen.findByRole("group", { name: "Đèn A" })).toBeInTheDocument();
    expect(screen.queryByRole("group", { name: "Mới" })).toBeNull();
  });

  it("dims tiles when snapshot fromCache and MQTT not online", async () => {
    mount();
    const tile = (await screen.findByRole("group", { name: "Đèn A" })).closest("[data-stale], div")!.parentElement!;
    expect(document.querySelector("[data-stale]")).toBeNull();
    await act(async () => {
      configStore.getState().setFromCache(true);
      connectionStore.getState().setMqtt("offline");
    });
    expect(document.querySelector("[data-stale]")).not.toBeNull();
    expect(tile).toBeTruthy();
    await act(async () => connectionStore.getState().setMqtt("online"));
    expect(document.querySelector("[data-stale]")).toBeNull();
  });

  it("toggle → pending → confirmed", async () => {
    const t = mount();
    const sw = await screen.findByRole("switch", { name: vi.dn2.turnOn("Đèn A") });
    await act(async () => fireEvent.click(sw));
    expect(t.sets).toEqual([{ deviceId: A.id, values: { state: true } }]);
    const busy = screen.getByRole("switch", { name: vi.dn2.turnOff("Đèn A") });
    expect(busy).toHaveAttribute("aria-busy", "true");
    await act(async () => t.confirm(A.id));
    const done = screen.getByRole("switch", { name: vi.dn2.turnOff("Đèn A") });
    expect(done).not.toHaveAttribute("aria-busy");
    expect(done).toHaveAttribute("aria-checked", "true");
  });

  it("3 tiles toggle independently", async () => {
    const t = mount();
    await screen.findByRole("group", { name: "Đèn A" });
    await act(async () => fireEvent.click(screen.getByRole("switch", { name: vi.dn2.turnOn("Đèn A") })));
    await act(async () => fireEvent.click(screen.getByRole("switch", { name: vi.dn2.turnOn("Đèn B") })));
    expect(screen.getByRole("switch", { name: vi.dn2.turnOff("Đèn A") })).toHaveAttribute("aria-busy", "true");
    expect(screen.getByRole("switch", { name: vi.dn2.turnOff("Đèn B") })).toHaveAttribute("aria-busy", "true");
    expect(screen.getByRole("switch", { name: vi.dn2.turnOff("Đèn C") })).not.toHaveAttribute("aria-busy");
    await act(async () => t.confirm(A.id));
    expect(screen.getByRole("switch", { name: vi.dn2.turnOff("Đèn A") })).not.toHaveAttribute("aria-busy");
    expect(screen.getByRole("switch", { name: vi.dn2.turnOff("Đèn B") })).toHaveAttribute("aria-busy", "true");
  });

  it("no state within 3 s → rollback + timeout toast", async () => {
    vitest.useFakeTimers();
    const tracker = new PendingTracker({
      onChange: (snap) => {
        const s = deviceStateStore.getState();
        const out: Record<string, Record<string, { value: never; sentAt: number }>> = {};
        for (const [id, keys] of Object.entries(snap))
          for (const [k, v] of Object.entries(keys)) (out[id] ??= {})[k] = { value: v as never, sentAt: Date.now() };
        s.setPending(out);
      },
      onTimeout: () => toastStore.getState().show({ kind: "timeout", text: vi.toast.timeout("Đèn A") }),
    });
    const t = mount();
    t.commands.setValues = async (id, values) => tracker.register(id, values as never);
    await vitest.waitFor(() => screen.getByRole("group", { name: "Đèn A" }));
    await act(async () => fireEvent.click(screen.getByRole("switch", { name: vi.dn2.turnOn("Đèn A") })));
    expect(screen.getByRole("switch", { name: vi.dn2.turnOff("Đèn A") })).toHaveAttribute("aria-busy", "true");
    await act(async () => void vitest.advanceTimersByTime(3100));
    expect(screen.getByRole("switch", { name: vi.dn2.turnOn("Đèn A") })).not.toHaveAttribute("aria-busy");
    expect(screen.getByText("Không nhận được phản hồi từ Đèn A")).toBeInTheDocument();
  });

  it("offline device has no toggle; hub offline shows banner with priority over LAN", async () => {
    sessionStore.setState({ mode: "lan" });
    mount({ hubStatus: { [hubId]: { v: 1, ts: 1, seq: 1, online: false } as never } });
    expect(await screen.findByText(/Hub Hub Nhà đang offline/)).toBeInTheDocument();
    expect(screen.queryByText(/chế độ LAN/)).toBeNull();
    expect(screen.queryAllByRole("switch")).toHaveLength(0);
  });

  it("LAN and reconnecting banners", async () => {
    sessionStore.setState({ mode: "lan" });
    mount();
    expect(await screen.findByText(/Đang dùng chế độ LAN/)).toBeInTheDocument();
    cleanup();
    sessionStore.setState({ mode: "cloud" });
    mount({ mqtt: "reconnecting" });
    expect(await screen.findByText("Đang kết nối lại…")).toBeInTheDocument();
    connectionStore.getState().setMqtt("online");
  });

  it("empty state when site has no active devices", async () => {
    mount({ devices: [N], states: [] });
    expect(await screen.findByText(vi.home.emptyTitle)).toBeInTheDocument();
  });

  it("+ opens SH-2 with the Home entries", async () => {
    mount();
    await act(async () => fireEvent.click(await screen.findByRole("button", { name: vi.home.add })));
    expect(uiStore.getState().sheet).toMatchObject({ kind: "sh2" });
    expect(await screen.findByText(vi.sh2.addHub)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: new RegExp(vi.sh2.arrange) })).not.toBeDisabled(); // enabled by B22
  });
});
