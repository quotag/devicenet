import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi as vitest } from "vitest";
import { RouterProvider, createMemoryHistory, createRootRoute, createRoute, createRouter } from "@tanstack/react-router";
import type { ReactNode } from "react";
import type { Device, EventDoc, HubId } from "@devicenet/shared";
import type { z } from "zod";
import { configStore, resetAll, sessionStore } from "@/stores";
import { vi } from "@/i18n/vi";
import { TransportProvider } from "@/transport/TransportProvider";
import { FirestoreConfigSource, type RawDoc, type SnapshotAdapter } from "@/transport/cloud/FirestoreConfigSource";
import { createFakeTransport } from "../../../test/fakeTransport";
import { HistoryScreen } from "./HistoryScreen";
import { HubDetailScreen } from "./HubDetailScreen";
import { MeScreen } from "./MeScreen";
import { SettingsScreen } from "./SettingsScreen";
import { groupByDay, toView } from "./history";

type Ev = z.infer<typeof EventDoc>;
const hubId = "hub_01HZZZZZZZZZZZZZZZZZZZZZZZ" as HubId;
const siteId = "site_01HZZZZZZZZZZZZZZZZZZZZZZZ";
const site = { id: siteId, name: "Nhà", timezone: "Asia/Ho_Chi_Minh", order: 0, createdAt: 1 };
const hubDoc = { id: hubId, name: "Hub Nhà", siteId, online: true, lastSeen: 1, agentVersion: "1.2.0" };
const NOW = new Date(2026, 9, 18, 12, 0, 0).getTime();
const H = 3_600_000;
const D = 24 * H;
const ev = (n: number, ts: number, extra: Partial<Ev> = {}): Ev =>
  ({ id: `evt_01HZZZZZZZZZZZZZZZZZZZZZZ${n}`, hubId, ts, type: "rule.fired", title: `E${n}`, expireAt: ts + 30 * D, ...extra }) as unknown as Ev;
const dev = (n: string, status = "active"): Device =>
  ({ id: `dev_01HZZZZZZZZZZZZZZZZZZZZZZ${n}`, hubId, siteId, roomId: null, name: n, icon: "plug", properties: {}, status, createdAt: 1, updatedAt: 1 }) as unknown as Device;

function mount(ui: ReactNode, opts: Parameters<typeof createFakeTransport>[0] = {}) {
  const t = createFakeTransport({ sites: [site] as never, hubs: [hubDoc] as never, ...opts });
  const root = createRootRoute({ component: () => <>{ui}</> });
  const router = createRouter({
    routeTree: root.addChildren([createRoute({ getParentRoute: () => root, path: "/$x" })]),
    history: createMemoryHistory({ initialEntries: ["/start"] }),
  });
  render(
    <TransportProvider transport={t}>
      <RouterProvider router={router} />
    </TransportProvider>,
  );
  return { t, router };
}

beforeEach(() => {
  resetAll();
  sessionStore.setState({ mode: "cloud", status: "ready", user: { uid: "u1", email: "a@b.c", displayName: "Thắng" } });
});
afterEach(cleanup);

describe("events listener (T116)", () => {
  it("converts Timestamp expireAt to epoch ms before EventDoc.parse", async () => {
    const subs = new Map<string, (d: RawDoc[], m: { fromCache: boolean }) => void>();
    const adapter: SnapshotAdapter = {
      onCollection(path, next) {
        subs.set(path.join("/"), next);
        return () => undefined;
      },
    };
    const src = new FirestoreConfigSource(adapter);
    src.start("tenant_X");
    await Promise.resolve();
    await Promise.resolve();
    const ts = (ms: number) => ({ toMillis: () => ms });
    subs.get("tenants/tenant_X/events")!(
      [
        { id: "evt_01HZZZZZZZZZZZZZZZZZZZZZZ1", data: { hubId, ts: 1000, type: "rule.fired", expireAt: ts(99_000) } },
        { id: "evt_01HZZZZZZZZZZZZZZZZZZZZZZ2", data: { hubId, ts: 2000, type: "notify", expireAt: ts(98_000) } },
      ],
      { fromCache: false },
    );
    const events = configStore.getState().events;
    expect(events.map((e) => e.ts)).toEqual([2000, 1000]);
    expect(events[1]!.expireAt).toBe(99_000);
    src.stop();
  });
});

describe("history grouping", () => {
  const names = { rules: {}, scenes: {} };
  it("groups by day with Hôm nay / Hôm qua / weekday, drops > 7 days, filters errors", () => {
    const events = [
      ev(1, NOW - H),
      ev(2, NOW - D, { result: "error", detail: { reason: "thiết bị offline" } }),
      ev(3, NOW - 3 * D, { type: "scene.run" }),
      ev(4, NOW - 9 * D),
    ];
    const g = groupByDay(events, NOW, false, names);
    expect(g.map((x) => x.label.split(",")[0])).toEqual([vi.hist.today, vi.hist.yesterday, expect.stringMatching(/Thứ|Chủ nhật/)]);
    expect(g.flatMap((x) => x.items).map((i) => i.title)).toEqual(["E1", "E2", "E3"]);
    expect(g[2]!.items[0]!.sub).toBe(vi.hist.kindScene);
    const errs = groupByDay(events, NOW, true, names);
    expect(errs).toHaveLength(1);
    expect(errs[0]!.items[0]!.sub).toBe(vi.hist.failed("thiết bị offline"));
  });

  it("resolves device name and formats device events properly", () => {
    const devNames = { rules: {}, scenes: {}, devices: { dev_1: { name: "Đèn trần" } } };
    const v1 = toView(ev(1, NOW, { type: "device.online", deviceId: "dev_1", title: undefined }), devNames);
    expect(v1.title).toBe("Đèn trần");
    expect(v1.sub).toBe(vi.hist.deviceOnline);
    expect(v1.error).toBe(false);

    const v2 = toView(ev(2, NOW, { type: "device.offline", deviceId: "dev_1", title: undefined }), devNames);
    expect(v2.title).toBe("Đèn trần");
    expect(v2.sub).toBe(vi.hist.deviceOffline);
    expect(v2.error).toBe(true);

    const v3 = toView(ev(3, NOW, { type: "device.found", deviceId: "dev_unknown", title: undefined, detail: { model: "SNZB-02" } }), devNames);
    expect(v3.title).toBe("SNZB-02");
    expect(v3.sub).toBe(vi.hist.deviceFound);
  });

  it("HistoryScreen chips + empty state", async () => {
    configStore.getState().setEvents([ev(1, NOW - H), ev(2, NOW - H - 1000, { type: "rule.broken", detail: { reason: "Thiết bị không còn" } })]);
    mount(<HistoryScreen now={() => NOW} />);
    expect(await screen.findAllByTestId("event-row")).toHaveLength(2);
    fireEvent.click(screen.getByRole("button", { name: vi.hist.errorsOnly }));
    expect(screen.getAllByTestId("event-row")).toHaveLength(1);
    expect(screen.getByText(vi.hist.kindBroken("Thiết bị không còn"))).toBeInTheDocument();
    act(() => configStore.getState().setEvents([]));
    expect(screen.getByText(vi.hist.emptyTitle)).toBeInTheDocument();
  });
});

describe("Me", () => {
  it("shows Zigbee warning when z2m is offline", async () => {
    mount(<MeScreen />, {
      hubStatus: { [hubId]: { v: 1, ts: NOW, seq: 1, online: true, agentVersion: "1.2.0", z2m: "offline" } },
    });
    expect(await screen.findByText(vi.me.z2mOffline)).toBeInTheDocument();
  });
  it("shows hub row, unnamed row, 5 latest events and history link", async () => {
    configStore.getState().setEvents([1, 2, 3, 4, 5, 6, 7].map((n) => ev(n, NOW - n * H)));
    mount(<MeScreen />, { devices: [dev("A"), dev("N", "new")] });
    expect(await screen.findByText("Hub Nhà")).toBeInTheDocument();
    expect(screen.getByText(vi.me.unnamedDevices(1))).toBeInTheDocument();
    expect(screen.getAllByTestId("event-row")).toHaveLength(5);
    expect(screen.getByText(vi.me.seeAll)).toBeInTheDocument();
  });

  it("noHub shows the guidance card", async () => {
    mount(<MeScreen />, { hubs: [] });
    expect(await screen.findByText(vi.me.noHub)).toBeInTheDocument();
  });
});

describe("remove hub flow", () => {
  it("needs the checkbox, then calls DELETE and returns to Me", async () => {
    const removeHub = vitest.fn(async () => undefined);
    const { router } = mount(<HubDetailScreen hubId={hubId} removeHub={removeHub} />);
    fireEvent.click(await screen.findByRole("button", { name: vi.me.remove }));
    const dlg = await screen.findByRole("dialog");
    const confirmBtn = dlg.querySelectorAll("button");
    const danger = Array.from(confirmBtn).find((b) => b.textContent === vi.me.remove)!;
    expect(danger).toBeDisabled();
    fireEvent.click(screen.getByRole("checkbox"));
    expect(danger).not.toBeDisabled();
    fireEvent.click(danger);
    await waitFor(() => expect(removeHub).toHaveBeenCalledWith(hubId));
    await waitFor(() => expect(router.state.location.pathname).toBe("/me"));
  });

  it("Giữ lại closes without calling the API", async () => {
    const removeHub = vitest.fn(async () => undefined);
    mount(<HubDetailScreen hubId={hubId} removeHub={removeHub} />);
    fireEvent.click(await screen.findByRole("button", { name: vi.me.remove }));
    fireEvent.click(await screen.findByRole("button", { name: vi.me.keep }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(removeHub).not.toHaveBeenCalled();
  });
});

describe("Settings", () => {
  it("has no delete-account row and a Sắp có notification badge", async () => {
    const out = vitest.fn();
    mount(<SettingsScreen signOutFn={out} />);
    expect(await screen.findByText(vi.s40.soon)).toBeInTheDocument();
    expect(screen.queryByText(/Xóa tài khoản/)).toBeNull();
    fireEvent.click(screen.getByText(vi.s40.signOut));
    expect(out).toHaveBeenCalled();
  });
});
