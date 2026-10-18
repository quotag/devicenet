import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { RouterProvider, createMemoryHistory, createRootRoute, createRoute, createRouter } from "@tanstack/react-router";
import type { Device, DeviceId, DeviceState, HubId } from "@devicenet/shared";
import { resetAll, toastStore } from "@/stores";
import { TransportProvider } from "@/transport/TransportProvider";
import { createFakeTransport, type FakeTransport } from "../../../test/fakeTransport";
import { DeviceDetailRoute } from "./DeviceDetailRoute";

const hub = "hub_01HZZZZZZZZZZZZZZZZZZZZZZZ" as HubId;
const site = "site_01HZZZZZZZZZZZZZZZZZZZZZZZ";
const id = "dev_01HZZZZZZZZZZZZZZZZZZZZZZA" as DeviceId;

const device = {
  id,
  hubId: hub,
  siteId: site,
  roomId: null,
  driver: "zigbee2mqtt",
  externalId: "0x00124b0024c1a3e2",
  vendor: "Tuya",
  model: "TS011F",
  firmware: "1.0.5",
  name: "Ổ cắm máy giặt",
  icon: "plug",
  primaryProperty: "power",
  properties: {
    state: { key: "state", label: "Nguồn", access: "rw", category: "control", type: "binary" },
    led: { key: "led", label: "Đèn LED", access: "rw", category: "control", type: "enum", values: ["off", "on", "inv"], valueLabels: { off: "Tắt", on: "Bật", inv: "Đảo" } },
    mode: { key: "mode", label: "Chế độ", access: "rw", category: "control", type: "enum", values: ["a", "b", "c", "d", "e"] },
    power: { key: "power", label: "Công suất", access: "r", category: "sensor", type: "numeric", unit: "W" },
    lock: { key: "lock", label: "Khóa nút", access: "rw", category: "config", type: "binary" },
    linkquality: { key: "linkquality", label: "LQI", access: "r", category: "diag", type: "numeric" },
  },
  status: "active",
  createdAt: 1,
  updatedAt: 1,
} as unknown as Device;

function state(online: boolean): DeviceState {
  const now = Date.now();
  return {
    v: 1, ts: now, seq: 1, deviceId: id, online, lastSeen: now,
    values: { state: true, led: "on", mode: "a", power: 86, lock: false },
    at: { state: now, power: now },
    lqi: 112,
  } as DeviceState;
}

let t: FakeTransport;

function mount(online = true) {
  t = createFakeTransport({
    devices: [device],
    states: [state(online)],
    sites: [{ id: site, name: "Nhà", timezone: "Asia/Ho_Chi_Minh", order: 0, createdAt: 1 } as never],
    hubs: [{ id: hub, siteId: site, name: "Hub Nhà", online: true, lastSeen: 1, claimedAt: 1, claimedBy: "u" } as never],
    commandMode: "manual",
  });
  const root = createRootRoute();
  const r = createRoute({ getParentRoute: () => root, path: "/device/$deviceId", component: DeviceDetailRoute });
  const router = createRouter({ routeTree: root.addChildren([r]), history: createMemoryHistory({ initialEntries: [`/device/${id}`] }) });
  render(
    <TransportProvider transport={t}>
      <RouterProvider router={router as never} />
    </TransportProvider>,
  );
}

beforeEach(() => {
  resetAll();
  toastStore.getState().reset();
});
afterEach(cleanup);

describe("DeviceDetail", () => {
  it("groups properties by category and shows hero", async () => {
    mount();
    expect(await screen.findByText("Đang bật · 86 W")).toBeTruthy();
    for (const g of ["Điều khiển", "Cảm biến", "Cấu hình", "Kỹ thuật"]) expect(screen.getByText(g)).toBeTruthy();
    expect(screen.getByText("Công suất")).toBeTruthy();
    expect(screen.getByText("Khóa nút")).toBeTruthy();
    expect(screen.getByText("zigbee2mqtt · TS011F")).toBeTruthy();
    expect(screen.getByText("112 / 255")).toBeTruthy();
    expect(screen.getByText("Hub Nhà")).toBeTruthy();
  });

  it("enum ≤ 4 renders segmented tabs and sends the choice; > 4 renders a select", async () => {
    mount();
    await screen.findByText("Đèn LED");
    fireEvent.click(screen.getByText("Đảo"));
    await waitFor(() => expect(t.sets).toEqual([{ deviceId: id, values: { led: "inv" } }]));
    expect(screen.getByRole("combobox", { name: "Chế độ" })).toBeTruthy();
  });

  it("offline disables controls and ping sends device.ping", async () => {
    mount(false);
    expect(await screen.findByText("Thiết bị không phản hồi")).toBeTruthy();
    expect(screen.getByText("Offline")).toBeTruthy();
    expect((screen.getByRole("switch", { name: "Nguồn" }) as HTMLButtonElement).disabled).toBe(true);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Tìm lại thiết bị" }));
    });
    expect(t.sent).toHaveLength(1);
    expect(t.sent[0]!.cmd).toMatchObject({ type: "device.ping", deviceId: id });
    await act(async () => t.timeout(t.sent[0]!.id));
    expect(toastStore.getState().current?.kind).toBe("timeout");
  });
});
