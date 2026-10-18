import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Device, DeviceId, HubId, SiteId } from "@devicenet/shared";
import { resetAll, uiStore } from "@/stores";
import { TransportProvider } from "@/transport/TransportProvider";
import { createFakeTransport, type FakeTransport } from "../../../../test/fakeTransport";
import { AddDeviceFlow, type AddDeviceStep } from "./AddDeviceFlow";

const hubId = "hub_01HZZZZZZZZZZZZZZZZZZZZZZZ" as HubId;
const siteId = "site_01HZZZZZZZZZZZZZZZZZZZZZZZ" as SiteId;
const devId = "dev_01HZZZZZZZZZZZZZZZZZZZZZZA" as DeviceId;

const hub = {
  id: hubId,
  siteId,
  name: "Hub Nhà",
  claimedAt: 1,
  claimedBy: "u1",
  online: true,
  lastSeen: 1,
  drivers: ["zigbee2mqtt"],
} as never;

function newDevice(): Device {
  return {
    id: devId,
    hubId,
    siteId,
    roomId: null,
    driver: "zigbee2mqtt",
    externalId: "0x0001",
    model: "TS011F",
    vendor: "Tuya",
    name: "TS011F",
    icon: "plug",
    properties: {
      power: { key: "power", label: "Công suất", access: "r", category: "sensor", type: "numeric", unit: "W" },
      voltage: { key: "voltage", label: "Điện áp", access: "r", category: "sensor", type: "numeric", unit: "V" },
    },
    status: "new",
    createdAt: 1,
    updatedAt: 1,
  } as Device;
}

const pairingState = (active: boolean, expiresAt?: number) =>
  ({ v: 1, ts: Date.now(), seq: 1, active, expiresAt, found: [] }) as never;

function mount(t: FakeTransport, step: AddDeviceStep, over: Partial<Parameters<typeof AddDeviceFlow>[0]> = {}) {
  return render(
    <TransportProvider transport={t}>
      <AddDeviceFlow
        step={step}
        onStep={() => {}}
        onExit={() => {}}
        onToHubs={() => {}}
        onDone={() => {}}
        {...over}
      />
    </TransportProvider>,
  );
}

beforeEach(() => {
  resetAll();
  uiStore.setState({ siteId });
});
afterEach(cleanup);

describe("S-11 step Find", () => {
  it("adopts a retained active pairing: counts down from expiresAt + clockOffset, no pairing.start", () => {
    const t = createFakeTransport({
      sites: [{ id: siteId, name: "Nhà", timezone: "Asia/Ho_Chi_Minh", order: 0, createdAt: 1 } as never],
      hubs: [hub],
      pairing: { [hubId]: pairingState(true, Date.now() + 5_000 + 87_000) },
      clockOffset: { [hubId]: 5_000 }, // hub clock 5 s ahead → 87 s left locally
      commandMode: "ok",
    });
    mount(t, "find");
    expect(screen.getByRole("timer")).toHaveAccessibleName("Còn 87 giây");
    expect(t.sent.filter((c) => c.cmd.type === "pairing.start")).toHaveLength(0);
  });

  it("sends pairing.start {120} on mount and pairing.stop on unmount", async () => {
    const t = createFakeTransport({ hubs: [hub], commandMode: "ok" });
    const { unmount } = mount(t, "find");
    await waitFor(() => expect(t.sent.map((c) => c.cmd)).toContainEqual({ type: "pairing.start", seconds: 120 }));
    unmount();
    expect(t.sent.map((c) => c.cmd.type)).toContain("pairing.stop");
  });

  it("shows the timeout state when pairing closes with nothing found, and Tìm lại restarts", async () => {
    const t = createFakeTransport({
      hubs: [hub],
      pairing: { [hubId]: pairingState(true, Date.now() + 60_000) },
      commandMode: "ok",
    });
    mount(t, "find");
    act(() => t.seed({ pairing: { [hubId]: pairingState(false) } }));
    expect(await screen.findByText("Chưa thấy thiết bị nào")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Tìm lại" }));
    await waitFor(() => expect(t.sent.filter((c) => c.cmd.type === "pairing.start")).toHaveLength(1));
  });

  it("lists found (status new) devices and continues with the count", () => {
    const onStep = vi.fn();
    const t = createFakeTransport({
      hubs: [hub],
      devices: [newDevice()],
      pairing: { [hubId]: pairingState(true, Date.now() + 60_000) },
      commandMode: "ok",
    });
    mount(t, "find", { onStep });
    expect(screen.getByText("Đã tìm thấy 1 thiết bị")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Tiếp tục với 1 thiết bị" }));
    expect(onStep).toHaveBeenCalledWith("name");
  });

  it("blocks with a banner when the hub is offline", () => {
    const t = createFakeTransport({ hubs: [{ ...(hub as object), online: false } as never], commandMode: "ok" });
    const onToHubs = vi.fn();
    mount(t, "find", { onToHubs });
    expect(screen.getByText("Hub Nhà đang offline · không thể tìm thiết bị")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Đến mục Hub trong Me" }));
    expect(onToHubs).toHaveBeenCalled();
    expect(t.sent).toHaveLength(0);
  });
});

describe("S-11 step Name", () => {
  it("save writes status active + presentation and sends device.rename", async () => {
    const onDone = vi.fn();
    const t = createFakeTransport({
      sites: [{ id: siteId, name: "Nhà", timezone: "Asia/Ho_Chi_Minh", order: 0, createdAt: 1 } as never],
      rooms: { [siteId]: [{ id: "room_1", name: "Bếp", order: 0 } as never] },
      hubs: [hub],
      devices: [newDevice()],
      commandMode: "ok",
    });
    mount(t, "name", { onDone });
    fireEvent.change(screen.getByLabelText("Tên thiết bị"), { target: { value: "Ổ cắm máy giặt" } });
    fireEvent.click(screen.getByRole("button", { name: "Bếp" }));
    fireEvent.click(screen.getByRole("radio", { name: /Điện áp/ }));
    fireEvent.click(screen.getByRole("button", { name: "Lưu" }));
    await waitFor(() => expect(onDone).toHaveBeenCalledWith(devId));
    expect(t.writeCalls).toEqual([
      {
        op: "updateDevicePresentation",
        deviceId: devId,
        p: { name: "Ổ cắm máy giặt", roomId: "room_1", icon: "plug", primaryProperty: "voltage", status: "active" },
      },
    ]);
    expect(t.sent.map((c) => c.cmd)).toContainEqual({ type: "device.rename", deviceId: devId, name: "Ổ cắm máy giặt" });
  });

  it("Room mới opens SH-5 newRoom", () => {
    const t = createFakeTransport({ hubs: [hub], devices: [newDevice()], commandMode: "ok" });
    mount(t, "name");
    fireEvent.click(screen.getByRole("button", { name: /Room mới/ }));
    expect(uiStore.getState().sheet).toMatchObject({ kind: "sh5", mode: "newRoom", siteId });
  });
});
