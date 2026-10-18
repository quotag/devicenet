import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { Device, HubId, Layout, Rule, Scene, SiteId } from "@devicenet/shared";
import { SheetHost } from "@/app/SheetHost";
import { DeleteDeviceSheet, referencingNames } from "@/features/device/DeleteDeviceSheet";
import { EditDeviceSheet } from "@/features/device/EditDeviceSheet";
import { RoomChips } from "@/features/home/RoomChips";
import { resetAll, toastStore, uiStore } from "@/stores";
import { TransportProvider } from "@/transport/TransportProvider";
import { roomDeletePlan } from "@/transport/writes";
import { createFakeTransport, type FakeTransport } from "../../test/fakeTransport";

const hubId = "hub_01HZZZZZZZZZZZZZZZZZZZZZZZ" as HubId;
const siteId = "site_01HZZZZZZZZZZZZZZZZZZZZZZZ" as SiteId;
const site2 = "site_01HZZZZZZZZZZZZZZZZZZZZZZY" as SiteId;
const room = "room_01HZZZZZZZZZZZZZZZZZZZZZZK";
const dev = (n: string, name: string, roomId: string | null): Device =>
  ({
    id: `dev_01HZZZZZZZZZZZZZZZZZZZZZZ${n}`,
    hubId,
    siteId,
    roomId,
    driver: "zigbee2mqtt",
    externalId: `0x${n}`,
    name,
    icon: "plug",
    primaryProperty: "power",
    properties: {
      state: { key: "state", label: "Nguồn", access: "rw", category: "control", type: "binary" },
      power: { key: "power", label: "Công suất", access: "r", category: "sensor", type: "numeric", unit: "W" },
    },
    status: "active",
    createdAt: 1,
    updatedAt: 1,
  }) as unknown as Device;
const washer = dev("A", "Ổ cắm máy giặt", room);
const fridge = dev("B", "Ổ cắm tủ lạnh", room);
const lamp = dev("C", "Đèn khách", null);

const scene: Scene = {
  id: "scn_01HZZZZZZZZZZZZZZZZZZZZZZA",
  siteId,
  hubId,
  name: "Đi ngủ",
  actions: [{ type: "setProperty", deviceId: lamp.id, property: "state", value: false }],
  rev: 1,
  updatedAt: 1,
} as unknown as Scene;
const ruleOnWasher: Rule = {
  id: "rule_01HZZZZZZZZZZZZZZZZZZZZZZA",
  siteId,
  hubId,
  name: "Máy giặt xong",
  enabled: true,
  trigger: { type: "property", deviceId: washer.id, property: "power", op: "lt", value: 5 },
  actions: [{ type: "setProperty", deviceId: lamp.id, property: "state", value: true }],
  rev: 1,
  appliedRev: 1,
  updatedAt: 1,
} as unknown as Rule;
const ruleOnScene: Rule = {
  id: "rule_01HZZZZZZZZZZZZZZZZZZZZZZB",
  siteId,
  hubId,
  name: "Tắt hết lúc 23:00",
  enabled: true,
  trigger: { type: "schedule", at: "23:00" },
  actions: [{ type: "runScene", sceneId: scene.id }],
  rev: 1,
  appliedRev: 1,
  updatedAt: 1,
} as unknown as Rule;

const layout = {
  siteId,
  rev: 3,
  updatedAt: 1,
  filters: { all: { cols: 2, tiles: {} }, [room]: { cols: 2, tiles: {} } },
} as unknown as Layout;

let t: FakeTransport;
function mount(ui: React.ReactNode, opts: { commandMode?: "ok" | "manual" | "timeout" } = {}) {
  t = createFakeTransport({
    sites: [
      { id: siteId, name: "Nhà", timezone: "Asia/Ho_Chi_Minh", order: 0, createdAt: 1 },
      { id: site2, name: "Nhà quê", timezone: "Asia/Ho_Chi_Minh", order: 1, createdAt: 2 },
    ] as never,
    rooms: { [siteId]: [{ id: room, name: "Bếp", order: 0 }] as never },
    hubs: [{ id: hubId, name: "Nhà", siteId, online: true }] as never,
    devices: [washer, fridge, lamp],
    rules: [ruleOnWasher, ruleOnScene],
    scenes: [scene],
    layouts: [layout],
    commandMode: opts.commandMode ?? "ok",
  });
  render(<TransportProvider transport={t}>{ui}</TransportProvider>);
  return t;
}

beforeEach(() => resetAll());
afterEach(cleanup);

describe("SH-1 site switcher", () => {
  it("lists sites, switches on tap and opens newSite", () => {
    uiStore.getState().setSiteId(siteId);
    uiStore.getState().openSheet({ kind: "sh1" });
    mount(<SheetHost />);
    expect(screen.getByText("Hub Nhà · 3 thiết bị · online")).toBeInTheDocument();
    expect(screen.getByText("Chưa có hub")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Nhà quê/ }));
    expect(uiStore.getState().siteId).toBe(site2);
    expect(uiStore.getState().sheet).toBeNull();
    uiStore.getState().openSheet({ kind: "sh1" });
  });

  it("Thêm site → SH-5 newSite", () => {
    uiStore.getState().openSheet({ kind: "sh1" });
    mount(<SheetHost />);
    fireEvent.click(screen.getByRole("button", { name: "Thêm site" }));
    expect(uiStore.getState().sheet).toMatchObject({ kind: "sh5", mode: "newSite" });
  });
});

describe("SH-3 quick edit", () => {
  it("saves presentation and sends device.rename when renamed", async () => {
    uiStore.getState().openSheet({ kind: "sh3", deviceId: washer.id });
    mount(<EditDeviceSheet device={washer} />);
    fireEvent.change(screen.getByLabelText("Tên"), { target: { value: "Máy giặt" } });
    fireEvent.click(screen.getByRole("radio", { name: "Đèn" }));
    fireEvent.click(screen.getByRole("button", { name: "Lưu" }));
    await waitFor(() => expect(t.sent.length).toBe(1));
    expect(t.writeCalls[0]).toMatchObject({
      op: "updateDevicePresentation",
      deviceId: washer.id,
      p: { name: "Máy giặt", roomId: room, icon: "lightbulb", primaryProperty: "power" },
    });
    expect(t.sent[0]!.cmd).toMatchObject({ type: "device.rename", deviceId: washer.id, name: "Máy giặt" });
    expect(uiStore.getState().sheet).toBeNull();
  });
});

describe("SH-4 delete device", () => {
  it("referencingNames covers rules and scenes", () => {
    expect(referencingNames(washer.id, { r: ruleOnWasher, r2: ruleOnScene } as never, { s: scene } as never)).toEqual(["Máy giặt xong"]);
    expect(referencingNames(lamp.id, { r: ruleOnWasher } as never, { s: scene } as never)).toEqual(["Máy giặt xong", "Đi ngủ"]);
  });

  it("step 1 lists referencing rules, checkbox gates step 2, then device.remove", async () => {
    uiStore.getState().openSheet({ kind: "sh4", deviceId: washer.id });
    let deleted = 0;
    mount(<DeleteDeviceSheet device={washer} onDeleted={() => deleted++} />);
    expect(screen.getByText('Xóa "Ổ cắm máy giặt"?')).toBeInTheDocument();
    expect(screen.getByText("Máy giặt xong")).toBeInTheDocument();
    expect(screen.getByText("Sẽ lỗi")).toBeInTheDocument();
    const next = screen.getByRole("button", { name: "Xóa" });
    expect(next).toBeDisabled();
    fireEvent.click(screen.getByRole("checkbox"));
    expect(next).toBeEnabled();
    fireEvent.click(next);
    expect(screen.getByText("Xóa vĩnh viễn?")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Xóa thiết bị" }));
    await waitFor(() => expect(deleted).toBe(1));
    expect(t.sent[0]!.cmd).toMatchObject({ type: "device.remove", deviceId: washer.id, force: false });
    expect(uiStore.getState().sheet).toBeNull();
  });

  it("shows an error toast when the hub times out", async () => {
    uiStore.getState().openSheet({ kind: "sh4", deviceId: washer.id });
    let deleted = 0;
    mount(<DeleteDeviceSheet device={washer} onDeleted={() => deleted++} />, { commandMode: "timeout" });
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: "Xóa" }));
    fireEvent.click(screen.getByRole("button", { name: "Xóa thiết bị" }));
    await waitFor(() => expect(toastStore.getState().current?.text ?? JSON.stringify(toastStore.getState())).toContain("Không xóa được thiết bị"));
    expect(deleted).toBe(0);
  });
});

describe("SH-5 room", () => {
  it("roomDeletePlan: devices roomId=null and layout filter dropped with rev+1", () => {
    const plan = roomDeletePlan(room, [washer.id, fridge.id], layout, 99);
    expect(plan.devicePatch).toEqual({ roomId: null, updatedAt: 99 });
    expect(plan.deviceIds).toEqual([washer.id, fridge.id]);
    expect(plan.layoutPatch).toEqual({ fieldPath: `filters.${room}`, rev: 4, updatedAt: 99 });
    expect(roomDeletePlan("room_other", [], layout).layoutPatch).toBeNull();
  });

  it("edit renames the room; Xóa room → confirm → deleteRoom batch", async () => {
    uiStore.getState().setSiteId(siteId);
    uiStore.getState().setFilter(room as never);
    uiStore.getState().openSheet({ kind: "sh5", mode: "edit", roomId: room });
    mount(<SheetHost />);
    expect(screen.getByText("2 thiết bị · site Nhà")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Tên room"), { target: { value: "Bếp mới" } });
    fireEvent.click(screen.getByRole("button", { name: "Lưu" }));
    await waitFor(() => expect(t.writeCalls[0]).toMatchObject({ op: "renameRoom", siteId, roomId: room, name: "Bếp mới" }));

    act(() => uiStore.getState().openSheet({ kind: "sh5", mode: "edit", roomId: room }));
    fireEvent.click(screen.getByRole("button", { name: "Xóa room" }));
    expect(uiStore.getState().sheet).toMatchObject({ mode: "confirm", roomId: room });
    expect(screen.getByText(/2 thiết bị sẽ chuyển về/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Xóa room" }));
    await waitFor(() => expect(t.writeCalls.some((c) => c.op === "deleteRoom")).toBe(true));
    const call = t.writeCalls.find((c) => c.op === "deleteRoom") as Extract<(typeof t.writeCalls)[number], { op: "deleteRoom" }>;
    expect(call).toMatchObject({ siteId, roomId: room, deviceIds: [washer.id, fridge.id] });
    expect(call.layout).toBe(layout);
    expect(uiStore.getState().filter).toBe("all");
  });

  it("newSite creates the site with the browser timezone and switches to it", async () => {
    uiStore.getState().openSheet({ kind: "sh5", mode: "newSite" });
    mount(<SheetHost />);
    const submit = screen.getByRole("button", { name: "Thêm site" });
    expect(submit).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Tên site"), { target: { value: "Văn phòng" } });
    fireEvent.click(submit);
    await waitFor(() => expect(t.writeCalls[0]).toMatchObject({ op: "createSite", name: "Văn phòng" }));
    const created = t.writeCalls[0] as Extract<(typeof t.writeCalls)[number], { op: "createSite" }>;
    expect(uiStore.getState().siteId).toBe(created.id);
  });

  it("pick offers room and site", () => {
    uiStore.getState().setSiteId(siteId);
    uiStore.getState().openSheet({ kind: "sh5", mode: "pick" });
    mount(<SheetHost />);
    fireEvent.click(screen.getByRole("button", { name: /Thêm room/ }));
    expect(uiStore.getState().sheet).toMatchObject({ mode: "newRoom", siteId });
  });

  it("long-press (500 ms) on a room chip opens edit", () => {
    mount(<RoomChips siteId={siteId} />);
    const chip = screen.getByRole("button", { name: "Bếp" });
    // useLongPress also fires on contextmenu, which is the deterministic path under jsdom.
    fireEvent.contextMenu(chip);
    expect(uiStore.getState().sheet).toMatchObject({ kind: "sh5", mode: "edit", roomId: room });
  });
});

describe("SH-6 scene / rule menu", () => {
  it("scene delete lists rules running it with 'Sẽ lỗi', then deletes the doc", async () => {
    uiStore.getState().openSheet({ kind: "sh6", type: "scene", id: scene.id });
    mount(<SheetHost />);
    expect(screen.getByText("Sửa")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Xóa" }));
    expect(screen.getByText('Xóa "Đi ngủ"?')).toBeInTheDocument();
    expect(screen.getByText("Tắt hết lúc 23:00")).toBeInTheDocument();
    expect(screen.getByText("Sẽ lỗi")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Xóa" }));
    await waitFor(() => expect(t.writeCalls[0]).toEqual({ op: "deleteScene", sceneId: scene.id }));
    expect(uiStore.getState().sheet).toBeNull();
  });

  it("rule delete removes the rule doc", async () => {
    uiStore.getState().openSheet({ kind: "sh6", type: "rule", id: ruleOnWasher.id });
    mount(<SheetHost />);
    fireEvent.click(screen.getByRole("button", { name: "Xóa" }));
    fireEvent.click(screen.getByRole("button", { name: "Xóa" }));
    await waitFor(() => expect(t.writeCalls[0]).toEqual({ op: "deleteRule", ruleId: ruleOnWasher.id }));
  });
});

