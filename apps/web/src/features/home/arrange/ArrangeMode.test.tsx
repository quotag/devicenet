import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi as vitest } from "vitest";
import { RouterProvider, createMemoryHistory, createRootRoute, createRoute, createRouter } from "@tanstack/react-router";
import type { Device, DeviceState, HubId } from "@devicenet/shared";
import { configStore, resetAll, sessionStore, uiStore } from "@/stores";
import { vi } from "@/i18n/vi";
import { TransportProvider } from "@/transport/TransportProvider";
import { SheetHost } from "@/app/SheetHost";
import { createFakeTransport } from "../../../../test/fakeTransport";
import { HomeScreen } from "../HomeScreen";
import { LONG_PRESS_MS } from "./useLongPress";

const saveLayout = vitest.fn(async () => undefined);
vitest.mock("@/transport/writes", async (orig) => ({
  ...(await orig<typeof import("@/transport/writes")>()),
  saveLayout: (...a: unknown[]) => saveLayout(...(a as [])),
}));

const hubId = "hub_01HZZZZZZZZZZZZZZZZZZZZZZZ" as HubId;
const siteId = "site_01HZZZZZZZZZZZZZZZZZZZZZZZ";
const dev = (n: string, name: string): Device =>
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
    status: "active",
    createdAt: n.charCodeAt(0),
    updatedAt: 1,
  }) as unknown as Device;
const st = (d: Device): DeviceState =>
  ({ v: 1, ts: 1, seq: 1, deviceId: d.id, online: true, lastSeen: 1, values: { state: false }, at: { state: 1 } }) as DeviceState;
const A = dev("A", "Đèn A");
const B = dev("B", "Đèn B");

function mount() {
  const t = createFakeTransport({
    sites: [{ id: siteId, name: "Nhà", timezone: "Asia/Ho_Chi_Minh", order: 0, createdAt: 1 }] as never,
    hubs: [{ id: hubId, name: "Hub", siteId, online: true }] as never,
    devices: [A, B],
    states: [st(A), st(B)],
    hubStatus: { [hubId]: { v: 1, ts: Date.now(), seq: 1, online: true } as never },
  });
  const root = createRootRoute({
    component: () => (
      <>
        <HomeScreen />
        <SheetHost />
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
}

beforeEach(() => {
  resetAll();
  saveLayout.mockClear();
  sessionStore.setState({ mode: "cloud", status: "ready", tenantId: "t1" as never });
});
afterEach(() => {
  cleanup();
  vitest.useRealTimers();
});

describe("Home arrange mode", () => {
  it("long-press enters: Xong replaces +, site switcher disabled, chips locked, hint shown", async () => {
    mount();
    const tile = await screen.findByRole("group", { name: "Đèn A" });
    vitest.useFakeTimers();
    fireEvent.pointerDown(tile, { clientX: 10, clientY: 10 });
    await act(async () => vitest.advanceTimersByTime(LONG_PRESS_MS));
    expect(uiStore.getState().arranging).toBe(true);
    expect(screen.getByRole("button", { name: vi.arrange.done })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: vi.home.add })).toBeNull();
    expect(screen.getByRole("button", { name: vi.arrange.siteDisabled })).toBeDisabled();
    expect(screen.getByText(vi.arrange.hint)).toBeInTheDocument();
    expect(screen.getByText(vi.common.all).closest("[aria-disabled]")).toHaveAttribute("aria-disabled", "true");
    expect(screen.queryByRole("switch")).toBeNull();
  });

  it("resize handle → 2×1, saved once after 500 ms with rev + 1; Xong exits", async () => {
    mount();
    await screen.findByRole("group", { name: "Đèn A" });
    act(() => uiStore.getState().setArranging(true));
    vitest.useFakeTimers();
    fireEvent.click(screen.getByRole("button", { name: vi.arrange.resize("Đèn B", false) }));
    expect(configStore.getState().layouts[siteId as never]!.filters.all!.tiles[B.id]!.w).toBe(2);
    expect(screen.getByRole("button", { name: vi.arrange.resize("Đèn B", true) })).toBeInTheDocument();
    await act(async () => vitest.advanceTimersByTimeAsync(499));
    expect(saveLayout).not.toHaveBeenCalled();
    await act(async () => vitest.advanceTimersByTimeAsync(1));
    expect(saveLayout).toHaveBeenCalledTimes(1);
    expect(saveLayout.mock.calls[0]).toMatchObject(["t1", { siteId, rev: 1 }]);
    fireEvent.click(screen.getByRole("button", { name: vi.arrange.done }));
    expect(uiStore.getState().arranging).toBe(false);
    expect(screen.getByRole("button", { name: vi.home.add })).toBeInTheDocument();
  });

  it("SH-2 'Sắp xếp tile' is enabled and enters arrange mode", async () => {
    mount();
    await screen.findByRole("group", { name: "Đèn A" });
    fireEvent.click(screen.getByRole("button", { name: vi.home.add }));
    const item = await screen.findByRole("button", { name: new RegExp(vi.sh2.arrange) });
    expect(item).not.toBeDisabled();
    fireEvent.click(item);
    expect(uiStore.getState().arranging).toBe(true);
  });
});
