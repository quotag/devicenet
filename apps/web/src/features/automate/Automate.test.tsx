import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi as vitest } from "vitest";
import type { Device, HubId, RunId, RunProgress, Rule, Scene } from "@devicenet/shared";
import { configStore, connectionStore, resetAll, sessionStore, toastStore } from "@/stores";
import { vi } from "@/i18n/vi";
import { TransportProvider } from "@/transport/TransportProvider";
import { createFakeTransport } from "../../../test/fakeTransport";
import { AutomateScreen } from "./AutomateScreen";
import { buildSuggestions } from "./suggestions";
import type { EditorTarget } from "./editorTarget";

const hubId = "hub_01HZZZZZZZZZZZZZZZZZZZZZZZ" as HubId;
const siteId = "site_01HZZZZZZZZZZZZZZZZZZZZZZZ";
const site = { id: siteId, name: "Nhà", timezone: "Asia/Ho_Chi_Minh", order: 0, createdAt: 1 };
const dev = (n: string, name: string, icon: string): Device =>
  ({
    id: `dev_01HZZZZZZZZZZZZZZZZZZZZZZ${n}`,
    hubId,
    siteId,
    roomId: null,
    driver: "zigbee2mqtt",
    externalId: `0x${n}`,
    name,
    icon,
    properties: {
      state: { key: "state", label: "Trạng thái", access: "rw", category: "control", type: "binary" },
      power: { key: "power", label: "Công suất", access: "r", category: "sensor", type: "numeric", unit: "W" },
    },
    status: "active",
    createdAt: 1,
    updatedAt: 1,
  }) as unknown as Device;
const washer = dev("A", "Ổ cắm máy giặt", "plug");
const yard = dev("B", "Đèn sân", "lightbulb");

const scene = (n: string, name: string): Scene => ({
  id: `scn_01HZZZZZZZZZZZZZZZZZZZZZZ${n}`,
  siteId,
  hubId,
  name,
  actions: [
    { type: "setProperty", deviceId: washer.id, property: "state", value: false },
    { type: "setProperty", deviceId: yard.id, property: "state", value: false },
  ],
  rev: 1,
  updatedAt: 1,
}) as unknown as Scene;
const rule = (n: string, name: string, extra: Partial<Rule> = {}): Rule =>
  ({
    id: `rule_01HZZZZZZZZZZZZZZZZZZZZZZ${n}`,
    siteId,
    hubId,
    name,
    enabled: true,
    trigger: { type: "schedule", at: "06:30" },
    actions: [{ type: "setProperty", deviceId: washer.id, property: "state", value: false }],
    rev: 2,
    appliedRev: 2,
    updatedAt: 1,
    ...extra,
  }) as unknown as Rule;

function mount(seed: { scenes?: Scene[]; rules?: Rule[] } = {}, tab: 0 | 1 = 0, open?: (t: EditorTarget) => void) {
  const t = createFakeTransport({
    sites: [site] as never,
    hubs: [{ id: hubId, name: "Hub", siteId, online: true }] as never,
    devices: [washer, yard],
    ...seed,
  });
  render(
    <TransportProvider transport={t}>
      <AutomateScreen initialTab={tab} onOpenEditor={open} />
    </TransportProvider>,
  );
  return t;
}

const progress = (runId: string, scn: Scene, status: RunProgress["status"], okSteps: number): RunProgress =>
  ({
    v: 1,
    ts: 1,
    seq: 1,
    runId,
    source: { kind: "scene", sceneId: scn.id },
    status,
    total: 2,
    steps: [0, 1].map((i) => ({ index: i, status: i < okSteps ? "ok" : "pending" })),
  }) as unknown as RunProgress;

beforeEach(() => {
  resetAll();
  sessionStore.setState({ mode: "cloud", status: "ready" });
  toastStore.getState().reset();
});
afterEach(() => {
  cleanup();
  vitest.useRealTimers();
});

describe("Automate scenes", () => {
  it("tap runs the scene and shows progress, ok tick, then clears", async () => {
    vitest.useFakeTimers({ shouldAdvanceTime: true });
    const sc = scene("A", "Đi ngủ");
    const t = mount({ scenes: [sc] });
    await act(async () => fireEvent.click(screen.getByRole("button", { name: vi.automate.runScene("Đi ngủ") })));
    expect(t.sent[0]!.cmd).toEqual({ type: "scene.run", sceneId: sc.id });
    await act(async () => t.ack(t.sent[0]!.id, { result: { runId: "run_01HZZZZZZZZZZZZZZZZZZZZZZZ" } }));
    await act(async () => connectionStore.getState().setRun("run_01HZZZZZZZZZZZZZZZZZZZZZZZ" as RunId, progress("run_01HZZZZZZZZZZZZZZZZZZZZZZZ", sc, "running", 1)));
    expect(screen.getByText(vi.automate.running(1, 2))).toBeInTheDocument();
    await act(async () => connectionStore.getState().setRun("run_01HZZZZZZZZZZZZZZZZZZZZZZZ" as RunId, progress("run_01HZZZZZZZZZZZZZZZZZZZZZZZ", sc, "ok", 2)));
    expect(screen.getByLabelText(vi.automate.runDone)).toBeInTheDocument();
    await act(async () => void vitest.advanceTimersByTime(1100));
    expect(screen.queryByLabelText(vi.automate.runDone)).toBeNull();
  });

  it("partial run shows the Lỗi badge", async () => {
    const sc = scene("A", "Đi ngủ");
    const t = mount({ scenes: [sc] });
    await act(async () => fireEvent.click(screen.getByRole("button", { name: vi.automate.runScene("Đi ngủ") })));
    await act(async () => t.ack(t.sent[0]!.id, { result: { runId: "run_01HZZZZZZZZZZZZZZZZZZZZZZZ" } }));
    await act(async () => connectionStore.getState().setRun("run_01HZZZZZZZZZZZZZZZZZZZZZZZ" as RunId, progress("run_01HZZZZZZZZZZZZZZZZZZZZZZZ", sc, "partial", 1)));
    expect(screen.getByText(vi.automate.runFailed)).toBeInTheDocument();
  });

  it("ack timeout shows an error toast", async () => {
    const t = mount({ scenes: [scene("A", "Đi ngủ")] });
    await act(async () => fireEvent.click(screen.getByRole("button", { name: vi.automate.runScene("Đi ngủ") })));
    await act(async () => t.timeout(t.sent[0]!.id));
    expect(toastStore.getState().current?.kind).toBe("error");
  });
});

describe("Automate rules", () => {
  it("syncing badge when appliedRev !== rev", () => {
    mount({ rules: [rule("A", "Tắt quạt", { appliedRev: 1 })] }, 1);
    expect(screen.getByText(vi.automate.badgeSyncing)).toBeInTheDocument();
    expect(screen.getByText(vi.automate.savedSyncing)).toBeInTheDocument();
    expect(screen.getByText("Mỗi ngày lúc 06:30")).toBeInTheDocument();
  });

  it("broken rule disables its switch and shows the reason", () => {
    mount({ rules: [rule("A", "Đèn sân", { brokenReason: "Thiết bị không còn: Đèn sân", lastResult: "broken" })] }, 1);
    expect(screen.getByRole("switch", { name: vi.automate.ruleBroken })).toBeDisabled();
    expect(screen.getByText("Thiết bị không còn: Đèn sân")).toBeInTheDocument();
    expect(screen.getByText(vi.automate.badgeError)).toBeInTheDocument();
  });

  it("switch writes enabled with the current rev", async () => {
    const t = mount({ rules: [rule("A", "Tắt quạt")] }, 1);
    await act(async () => fireEvent.click(screen.getByRole("switch", { name: vi.automate.ruleToggle("Tắt quạt") })));
    expect(t.writeCalls).toEqual([{ op: "setRuleEnabled", ruleId: rule("A", "").id, enabled: false, rev: 2 }]);
  });

  it("tapping a card opens the editor", () => {
    const open = vitest.fn();
    mount({ rules: [rule("A", "Tắt quạt")] }, 1, open);
    fireEvent.click(screen.getByText("Tắt quạt"));
    expect(open).toHaveBeenCalledWith({ kind: "edit", mode: "rule", id: rule("A", "").id });
  });
});

describe("Automate empty + suggestions", () => {
  it("empty scenes list shows suggestions that open a prefilled editor", () => {
    const open = vitest.fn();
    mount({}, 0, open);
    expect(screen.getByText(vi.automate.emptyScene)).toBeInTheDocument();
    fireEvent.click(screen.getByText("Tắt hết ổ cắm"));
    const arg = open.mock.calls[0]![0] as EditorTarget;
    expect(arg.kind).toBe("suggestion");
  });

  it("templates are built from existing devices", () => {
    const s = buildSuggestions([washer, yard], "scene").map((x) => x.title);
    expect(s).toEqual(["Tắt hết ổ cắm", "Bật đèn sân"]);
    const r = buildSuggestions([washer, yard], "rule").map((x) => x.title);
    expect(r).toContain("Báo khi công suất > 1500 W");
    expect(buildSuggestions([], "rule")).toEqual([]);
  });
});

void configStore;
