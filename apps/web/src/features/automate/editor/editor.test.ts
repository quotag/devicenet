import { describe, expect, it, vi as vit, afterEach } from "vitest";
import { ulid } from "ulid";
import { Rule, type Scene } from "@devicenet/shared";
import { configStore } from "@/stores/config";
import { vi } from "@/i18n/vi";
import {
  draftFromRule,
  draftFromScene,
  draftFromSuggestion,
  editorReducer,
  newDraft,
  toWire,
  type EditorAction,
  type EditorDraft,
} from "./state";
import { validate, issueFor, buildCandidate } from "./validate";
import { awaitApplied, saveDraft, type SaveDeps } from "./save";
import { zodIssueToVi } from "./zodVi";
import { configDocPayload } from "@/transport/writes";

const DEV = `dev_${ulid()}`;
const DEV2 = `dev_${ulid()}`;
const SITE = `site_${ulid()}`;
const HUB = `hub_${ulid()}`;
const ctx = { siteId: SITE, hubId: HUB, updatedAt: 1 };

const run = (d: EditorDraft, ...as: EditorAction[]) => as.reduce(editorReducer, d);

const lightOn = { type: "setProperty", deviceId: DEV2, property: "on", value: true } as const;

function validRule(): EditorDraft {
  return run(
    newDraft("rule"),
    { type: "setName", name: "Bật đèn khi tối" },
    { type: "setTrigger", trigger: { type: "property", deviceId: DEV, property: "illuminance", op: "lt", value: 20 } },
    { type: "addAction", action: lightOn },
  );
}

describe("RuleEditor state", () => {
  it("new rule draft is not valid (Save disabled) until trigger + action + name", () => {
    let d = newDraft("rule");
    expect(validate(d, ctx).ok).toBe(false);
    d = run(d, { type: "setName", name: "R" });
    expect(validate(d, ctx).ok).toBe(false);
    d = run(d, { type: "setTrigger", trigger: { type: "schedule", at: "06:30" } });
    const r = validate(d, ctx);
    expect(r.ok).toBe(false);
    expect(issueFor(r, "actions")).toBe(vi.s30.errors.actionsMin);
    d = run(d, { type: "addAction", action: lightOn });
    expect(validate(d, ctx).ok).toBe(true);
  });

  it("op changed hides/strips value and for", () => {
    let d = run(validRule(), { type: "patchTrigger", patch: { forMin: 3 } });
    expect(d.trigger).toMatchObject({ value: 20, forMin: 3 });
    d = run(d, { type: "patchTrigger", patch: { op: "changed" } });
    expect(d.trigger).not.toHaveProperty("value");
    expect(d.trigger).not.toHaveProperty("forMin");
    // even if the UI tries to set them afterwards
    d = run(d, { type: "patchTrigger", patch: { value: 5, forMin: 2 } });
    expect(d.trigger).toEqual({ type: "property", deviceId: DEV, property: "illuminance", op: "changed" });
    const r = validate(d, ctx);
    expect(r.ok).toBe(true);
    if (r.ok && r.kind === "rule") expect(r.doc.trigger).not.toHaveProperty("for");
  });

  it("changed with value is rejected by the shared schema with a Vietnamese message", () => {
    const d = validRule();
    const cand = { ...buildCandidate(d, ctx), trigger: { type: "property", deviceId: DEV, property: "on", op: "changed", value: 1 } };
    const res = Rule.safeParse(cand);
    expect(res.success).toBe(false);
    if (!res.success) expect(res.error.issues.map(zodIssueToVi)).toContain(vi.s30.errors.changedNoValue);
    // the editor itself never emits it: toWire drops value for `changed`
    const raw = { ...d, trigger: { type: "property" as const, deviceId: DEV, property: "on", op: "changed" as const, value: 1 } };
    expect(toWire(raw).trigger).not.toHaveProperty("value");
  });

  it("for 3 minutes is saved as 180 seconds; existing for=180 loads as 3 minutes (D-13)", () => {
    const d = run(validRule(), { type: "patchTrigger", patch: { forMin: 3 } });
    const r = validate(d, ctx);
    expect(r.ok).toBe(true);
    if (!r.ok || r.kind !== "rule") throw new Error();
    expect(r.doc.trigger).toMatchObject({ for: 180 });
    const back = draftFromRule({ ...r.doc });
    expect(back.trigger).toMatchObject({ forMin: 3 });
  });

  it("delay minutes ↔ seconds", () => {
    const d = run(validRule(), { type: "addAction", action: { type: "delay", minutes: 2 } });
    const r = validate(d, ctx);
    if (!r.ok) throw new Error(JSON.stringify(r.issues));
    expect(r.doc.actions[1]).toEqual({ type: "delay", seconds: 120 });
    expect(draftFromRule(r.doc as Rule).actions[1]!.item).toEqual({ type: "delay", minutes: 2 });
  });

  it("missing value maps to the trigger block with a Vietnamese message", () => {
    const d = run(validRule(), { type: "setTrigger", trigger: { type: "property", deviceId: DEV, property: "power", op: "gt" } });
    const r = validate(d, ctx);
    expect(r.ok).toBe(false);
    expect(r.blocks.has("trigger")).toBe(true);
    expect(issueFor(r, "trigger")).toBe(vi.s30.errors.valueRequired);
  });

  it("scene without trigger is valid; scene ignores trigger/conditions", () => {
    let d = run(newDraft("scene"), { type: "setName", name: "Đi ngủ" }, { type: "addAction", action: lightOn });
    d = run(d, { type: "setTrigger", trigger: { type: "schedule", at: "23:00" } }, { type: "addCondition", condition: { type: "dayOfWeek", days: [1] } });
    expect(d.trigger).toBeUndefined();
    expect(d.conditions.items).toHaveLength(0);
    const r = validate(d, ctx);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.kind).toBe("scene");
      expect(r.doc.id).toMatch(/^scn_/);
      expect(r.doc).not.toHaveProperty("trigger");
    }
  });

  it("conditions add/remove + AND/OR, issue mapped to the condition block", () => {
    let d = run(validRule(), { type: "addCondition", condition: { type: "timeWindow", from: "18:00", to: "06:00" } });
    d = run(d, { type: "addCondition", condition: { type: "property", deviceId: DEV, property: "on", op: "eq" } });
    let r = validate(d, ctx);
    expect(r.ok).toBe(false);
    const badKey = d.conditions.items[1]!.key;
    expect(r.blocks.has(`condition:${badKey}`)).toBe(true);
    expect(issueFor(r, `condition:${badKey}`)).toBe(vi.s30.errors.valueRequired);

    d = run(d, { type: "setConditionOp", op: "any" });
    r = validate(d, ctx);
    expect(r.blocks.has(`condition:${badKey}`)).toBe(true);

    d = run(d, { type: "removeCondition", key: badKey });
    r = validate(d, ctx);
    expect(r.ok).toBe(true);
    if (r.ok && r.kind === "rule") expect(r.doc.conditions).toEqual({ any: [{ type: "timeWindow", from: "18:00", to: "06:00" }] });

    d = run(d, { type: "removeCondition", key: d.conditions.items[0]!.key });
    r = validate(d, ctx);
    if (r.ok && r.kind === "rule") expect(r.doc).not.toHaveProperty("conditions");
  });

  it("actions add/update/remove/reorder keep keys stable", () => {
    let d = run(
      validRule(),
      { type: "addAction", action: { type: "delay", minutes: 1 } },
      { type: "addAction", action: { type: "notify", title: "" } },
    );
    const keys = d.actions.map((a) => a.key);
    let r = validate(d, ctx);
    expect(issueFor(r, `action:${keys[2]}`)).toBe(vi.s30.errors.notifyTitleRequired);

    d = run(d, { type: "moveAction", from: 2, to: 0 });
    expect(d.actions.map((a) => a.key)).toEqual([keys[2], keys[0], keys[1]]);
    r = validate(d, ctx);
    expect(issueFor(r, `action:${keys[2]}`)).toBe(vi.s30.errors.notifyTitleRequired);

    d = run(d, { type: "updateAction", key: keys[2]!, action: { type: "notify", title: "Trời tối" } });
    r = validate(d, ctx);
    if (!r.ok) throw new Error(JSON.stringify(r.issues));
    expect(r.doc.actions.map((a) => a.type)).toEqual(["notify", "setProperty", "delay"]);

    d = run(d, { type: "removeAction", key: keys[0]! }, { type: "moveAction", from: 0, to: 9 });
    expect(d.actions.map((a) => a.key)).toEqual([keys[2], keys[1]]);
  });

  it("no hub on the site blocks Save", () => {
    const r = validate(validRule(), { siteId: SITE, hubId: undefined });
    expect(r.ok).toBe(false);
    expect(issueFor(r, "general")).toBe(vi.s30.errors.noHub);
  });

  it("existing rule / scene / suggestion drafts", () => {
    const rule: Rule = {
      id: `rule_${ulid()}`, siteId: SITE, hubId: HUB, name: "R", enabled: false, rev: 4, updatedAt: 1, appliedRev: 4,
      trigger: { type: "sun", event: "sunset", offsetMin: -10 },
      conditions: { all: [{ type: "dayOfWeek", days: [1, 2] }] },
      actions: [lightOn],
    };
    const d = draftFromRule(rule);
    expect(d).toMatchObject({ id: rule.id, isNew: false, rev: 4, enabled: false, mode: "rule" });
    const r = validate(d, { siteId: SITE, hubId: HUB });
    if (!r.ok || r.kind !== "rule") throw new Error();
    expect(r.doc.rev).toBe(5);
    expect(r.doc).not.toHaveProperty("appliedRev");
    expect(r.doc.conditions).toEqual(rule.conditions);

    const scene: Scene = { id: `scn_${ulid()}`, siteId: SITE, hubId: HUB, name: "S", actions: [lightOn], rev: 2, updatedAt: 1 };
    expect(draftFromScene(scene)).toMatchObject({ mode: "scene", rev: 2, isNew: false });

    const s = draftFromSuggestion("rule", { name: "Tắt lúc 23:00", trigger: { type: "schedule", at: "23:00" }, actions: [lightOn] });
    expect(s).toMatchObject({ isNew: true, rev: 0, enabled: true });
    expect(validate(s, ctx).ok).toBe(true);
  });
});

describe("save", () => {
  afterEach(() => {
    configStore.getState().reset();
    vit.useRealTimers();
  });

  it("writes rev+1 with site hub, resolves applied when appliedRev === rev", async () => {
    const d = validRule();
    const written: Rule[] = [];
    const deps: SaveDeps = {
      saveRule: async (_t, r) => { written.push(r); },
      saveScene: async () => {},
      awaitApplied,
    };
    const p = saveDraft(d, { tenantId: "tenant_x", siteId: SITE, hubId: HUB, now: 42 }, deps);
    await Promise.resolve();
    await Promise.resolve();
    expect(written[0]).toMatchObject({ id: d.id, rev: 1, hubId: HUB, updatedAt: 42 });
    configStore.getState().setRules({ [d.id]: { ...written[0]!, appliedRev: 1 } });
    await expect(p).resolves.toMatchObject({ ok: true, rev: 1, status: "applied" });
  });

  it("awaitApplied → syncing after timeout", async () => {
    vit.useFakeTimers();
    const p = awaitApplied("scene", "scn_x", 3, 5000);
    vit.advanceTimersByTime(5000);
    await expect(p).resolves.toBe("syncing");
  });

  it("invalid draft does not write", async () => {
    const saveRule = vit.fn();
    const res = await saveDraft(newDraft("rule"), { tenantId: "t", siteId: SITE, hubId: HUB }, { saveRule, saveScene: vit.fn(), awaitApplied });
    expect(res.ok).toBe(false);
    expect(saveRule).not.toHaveBeenCalled();
  });

  it("payload keeps only app-writable keys", () => {
    const p = configDocPayload("scene", { id: "scn_1", name: "S", actions: [], rev: 1, updatedAt: 1, appliedRev: 1, enabled: true, icon: undefined });
    expect(p).toEqual({ id: "scn_1", name: "S", actions: [], rev: 1, updatedAt: 1 });
  });
});
