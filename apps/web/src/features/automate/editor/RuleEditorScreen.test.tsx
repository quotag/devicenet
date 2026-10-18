import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi as vitest } from "vitest";
import type { Device, HubId, Rule, RunId, RunProgress } from "@devicenet/shared";
import { connectionStore, resetAll, sessionStore, toastStore, uiStore } from "@/stores";
import { vi } from "@/i18n/vi";
import { TransportProvider } from "@/transport/TransportProvider";
import { createFakeTransport } from "../../../../test/fakeTransport";
import { RuleEditorScreen } from "./RuleEditorScreen";
import type { SaveDeps } from "./save";

const t = vi.s30;
const hubId = "hub_01HZZZZZZZZZZZZZZZZZZZZZZZ" as HubId;
const siteId = "site_01HZZZZZZZZZZZZZZZZZZZZZZZ";
const site = { id: siteId, name: "Nhà", timezone: "Asia/Ho_Chi_Minh", order: 0, createdAt: 1 };
const washer = {
  id: "dev_01HZZZZZZZZZZZZZZZZZZZZZZA",
  hubId,
  siteId,
  roomId: null,
  driver: "zigbee2mqtt",
  externalId: "0xA",
  name: "Ổ cắm máy giặt",
  icon: "plug",
  properties: {
    state: { key: "state", label: "Trạng thái", access: "rw", category: "control", type: "binary" },
    power: { key: "power", label: "Công suất", access: "r", category: "sensor", type: "numeric", unit: "W" },
  },
  status: "active",
  createdAt: 1,
  updatedAt: 1,
} as unknown as Device;

function mount(opts: { mode?: "cloud" | "lan"; deps?: SaveDeps; onClose?: () => void } = {}) {
  const tr = createFakeTransport({ mode: opts.mode, sites: [site] as never, hubs: [{ id: hubId, name: "Hub", siteId, online: true }] as never, devices: [washer], commandMode: "manual" });
  render(
    <TransportProvider transport={tr}>
      <RuleEditorScreen target={{ kind: "new", mode: "rule" }} onClose={opts.onClose ?? (() => {})} saveDeps={opts.deps} />
    </TransportProvider>,
  );
  return tr;
}

const pick = (name: string, value: string) => fireEvent.change(screen.getByRole("combobox", { name }), { target: { value } });

async function buildRule() {
  fireEvent.change(screen.getByLabelText(t.nameLabel), { target: { value: "Máy giặt xong" } });
  fireEvent.click(screen.getByRole("button", { name: `${t.add} ${t.when}` }));
  pick(t.device, washer.id);
  pick(t.property, "power");
  fireEvent.click(screen.getByRole("button", { name: t.ops.lt }));
  fireEvent.change(screen.getByLabelText(t.value), { target: { value: "5" } });
  fireEvent.change(screen.getByLabelText(t.forMin), { target: { value: "3" } });
  fireEvent.click(screen.getByRole("button", { name: t.addTrigger }));
  await waitFor(() => expect(screen.queryByText(t.forMin)).toBeNull());

  fireEvent.click(screen.getByRole("button", { name: `${t.add} ${t.then}` }));
  pick(t.device, washer.id);
  pick(t.property, "state");
  fireEvent.click(screen.getByText(t.off));
  fireEvent.click(screen.getByRole("button", { name: t.saveSheet }));
  await waitFor(() => expect(screen.queryByText(t.errors.actionsMin)).toBeNull());
}

beforeEach(() => {
  resetAll();
  sessionStore.setState({ mode: "cloud", status: "ready", tenantId: "tenant_01HZZZZZZZZZZZZZZZZZZZZZZZ" as never });
  uiStore.setState({ siteId: siteId as never });
  toastStore.getState().reset();
});
afterEach(cleanup);

describe("RuleEditorScreen", () => {
  it("starts invalid (Lưu disabled, actions block warns), then builds a property rule and saves", async () => {
    const saved: Rule[] = [];
    const deps: SaveDeps = {
      saveRule: async (_t, r) => void saved.push(r),
      saveScene: async () => {},
      awaitApplied: async () => "applied",
    };
    const onClose = vitest.fn();
    mount({ deps, onClose });
    expect(screen.getByRole("button", { name: t.save })).toBeDisabled();
    expect(screen.getByText(t.errors.actionsMin)).toBeInTheDocument();

    await buildRule();
    expect(screen.getByRole("button", { name: t.save })).toBeEnabled();
    await act(async () => fireEvent.click(screen.getByRole("button", { name: t.save })));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(saved).toHaveLength(1);
    expect(saved[0]).toMatchObject({
      name: "Máy giặt xong",
      hubId,
      siteId,
      rev: 1,
      trigger: { type: "property", deviceId: washer.id, property: "power", op: "lt", value: 5, for: 180 },
      actions: [{ type: "setProperty", deviceId: washer.id, property: "state", value: false }],
    });
  });

  it("LAN build: Lưu disabled with tooltip", () => {
    sessionStore.setState({ mode: "lan" });
    mount({ mode: "lan" });
    const btn = screen.getByRole("button", { name: t.save });
    expect(btn).toBeDisabled();
    expect(btn).toHaveAttribute("title", t.saveLanTip);
  });

  it("Chạy thử sends actions.test and shows inline run steps", async () => {
    const tr = mount();
    fireEvent.click(screen.getByRole("button", { name: `${t.add} ${t.then}` }));
    pick(t.device, washer.id);
    pick(t.property, "state");
    fireEvent.click(screen.getByText(t.off));
    fireEvent.click(screen.getByRole("button", { name: t.saveSheet }));
    const btn = await screen.findByRole("button", { name: t.test });
    await waitFor(() => expect(btn).toBeEnabled());
    await act(async () => fireEvent.click(btn));
    expect(tr.sent[0]!.cmd).toMatchObject({ type: "actions.test", actions: [{ type: "setProperty", value: false }] });
    const runId = "run_01HZZZZZZZZZZZZZZZZZZZZZZZ";
    await act(async () => tr.ack(tr.sent[0]!.id, { result: { runId } }));
    await act(async () =>
      connectionStore.getState().setRun(runId as RunId, { v: 1, ts: 1, seq: 1, runId, source: { kind: "test" }, status: "ok", total: 1, steps: [{ index: 0, status: "ok" }] } as unknown as RunProgress),
    );
    expect(within(screen.getByRole("list", { name: t.test })).getByText(t.testStep(1, t.stepStatus.ok))).toBeInTheDocument();
  });
});
