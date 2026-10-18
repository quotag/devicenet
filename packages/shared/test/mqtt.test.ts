import { describe, expect, it } from "vitest";
import * as S from "../src";
import { CMD, D, EVT, H, RULE, RUN, SCN, T, plugState } from "./fixtures";

const ok = (s: { safeParse: (v: unknown) => { success: boolean } }, v: unknown) => s.safeParse(v).success;
const env = { v: 1, ts: 1_760_000_000_000, seq: 1 };

describe("topics", () => {
  const tt = T as S.TenantId, hh = H as S.HubId, dd = D as S.DeviceId;
  it("builders", () => {
    expect(S.topics.root(tt)).toBe(`t/${T}`);
    expect(S.topics.state(tt, hh, dd)).toBe(`t/${T}/h/${H}/d/${D}/state`);
    expect(S.topics.set(tt, hh, dd)).toBe(`t/${T}/h/${H}/d/${D}/set`);
    expect(S.topics.ack(tt, hh)).toBe(`t/${T}/h/${H}/cmd/ack`);
    expect(S.topics.tenantWildcard(tt)).toBe(`t/${T}/#`);
    expect(S.topics.hubSubscriptions(tt, hh)).toEqual([`t/${T}/h/${H}/d/+/set`, `t/${T}/h/${H}/cmd`]);
  });
  it("parseTopic round-trips every builder", () => {
    for (const k of ["status", "cmd", "events", "pairing", "runs"] as const)
      expect(S.parseTopic(S.topics[k](tt, hh))).toEqual({ kind: k, tenantId: T, hubId: H });
    expect(S.parseTopic(S.topics.ack(tt, hh))).toEqual({ kind: "ack", tenantId: T, hubId: H });
    for (const k of ["state", "set", "history"] as const)
      expect(S.parseTopic(S.topics[k](tt, hh, dd))).toEqual({ kind: k, tenantId: T, hubId: H, deviceId: D });
  });
  it("parseTopic rejects garbage", () => {
    for (const t of ["", "zigbee2mqtt/plug", `t/${T}`, `t/${T}/h/${H}`, `t/${T}/h/${H}/foo`, `t/${T}/h/${H}/d/${D}/bad`, `x/${T}/h/${H}/status`])
      expect(S.parseTopic(t)).toBeNull();
  });
  it("topicPolicy matrix", () => {
    expect(S.topicPolicy.state).toEqual({ qos: 1, retain: true });
    expect(S.topicPolicy.set.retain).toBe(false);
    expect(S.topicPolicy.events.qos).toBe(0);
  });
  it("constants", () => {
    expect(S.MQTT_CONTRACT_VERSION).toBe(1);
    expect(S.CMD_ACK_TIMEOUT_MS).toBe(5000);
    expect(S.SET_CONFIRM_TIMEOUT_MS).toBe(3000);
  });
});

describe("HubStatus / LWT", () => {
  it("HubStatus", () => {
    expect(ok(S.HubStatus, { ...env, online: true, agentVersion: "1.0.0", z2m: "online", lanUrl: "http://192.168.1.20:8080", platform: "windows" })).toBe(true);
    expect(ok(S.HubStatus, { ...env, online: true, agentVersion: "1", z2m: "weird" })).toBe(false);
  });
  it("hubLwt is a valid offline status", () => {
    const l = S.hubLwt();
    expect(l.online).toBe(false);
    expect(ok(S.HubStatus, l)).toBe(true);
  });
});

describe("DeviceState", () => {
  it("valid TS011F snapshot", () => { expect(ok(S.DeviceState, plugState)).toBe(true); });
  it("invalid", () => {
    expect(ok(S.DeviceState, { ...plugState, lqi: 300 })).toBe(false);
    expect(ok(S.DeviceState, { ...plugState, values: { Power: 1 } })).toBe(false);
    expect(ok(S.DeviceState, { ...plugState, v: 2 })).toBe(false);
  });
  it("defaults v", () => {
    const { v: _v, ...rest } = plugState;
    expect(S.DeviceState.parse(rest).v).toBe(1);
  });
});

describe("SetCommand", () => {
  it("valid / empty", () => {
    expect(ok(S.SetCommand, { values: { state: true } })).toBe(true);
    expect(ok(S.SetCommand, { values: {} })).toBe(false);
  });
});

describe("Command / CommandEnvelope / CommandAck", () => {
  const cmds: unknown[] = [
    { type: "pairing.start" }, { type: "pairing.stop" },
    { type: "device.remove", deviceId: D }, { type: "device.rename", deviceId: D, name: "Đèn" },
    { type: "device.ping", deviceId: D }, { type: "scene.run", sceneId: SCN },
    { type: "actions.test", actions: [{ type: "delay", seconds: 1 }] },
    { type: "history.get", deviceId: D, property: "power", from: 1, to: 2 },
    { type: "config.resync" }, { type: "state.republish" },
  ];
  it.each(cmds.map((c) => [(c as { type: string }).type, c]))("Command %s valid", (_n, c) => { expect(ok(S.Command, c)).toBe(true); });
  it("defaults", () => {
    expect((S.Command.parse({ type: "pairing.start" }) as { seconds: number }).seconds).toBe(120);
    expect((S.Command.parse({ type: "device.remove", deviceId: D }) as { force: boolean }).force).toBe(false);
    expect((S.Command.parse({ type: "history.get", deviceId: D, property: "power", from: 1, to: 2 }) as { step: number }).step).toBe(300);
  });
  it("Command invalid", () => {
    expect(ok(S.Command, { type: "pairing.start", seconds: 5 })).toBe(false);
    expect(ok(S.Command, { type: "device.remove" })).toBe(false);
    expect(ok(S.Command, { type: "actions.test", actions: [] })).toBe(false);
    expect(ok(S.Command, { type: "history.get", deviceId: D, property: "power", from: 1, to: 2, step: 10 })).toBe(false);
    expect(ok(S.Command, { type: "nope" })).toBe(false);
  });
  it("CommandEnvelope", () => {
    expect(ok(S.CommandEnvelope, { id: CMD, sentAt: 1, cmd: { type: "pairing.stop" } })).toBe(true);
    expect(ok(S.CommandEnvelope, { id: D, sentAt: 1, cmd: { type: "pairing.stop" } })).toBe(false);
  });
  it("AckError", () => { expect(ok(S.AckError, "busy")).toBe(true); expect(ok(S.AckError, "oops")).toBe(false); });
  it("CommandAck", () => {
    expect(ok(S.CommandAck, { ...env, id: CMD, ok: true, result: { runId: RUN } })).toBe(true);
    expect(ok(S.CommandAck, { ...env, id: CMD, ok: false, error: "bad" })).toBe(false);
  });
});

describe("PairingState", () => {
  it("valid + default found", () => {
    expect(S.PairingState.parse({ ...env, active: true, expiresAt: 1_760_000_120_000 }).found).toEqual([]);
  });
  it("invalid", () => { expect(ok(S.PairingState, { ...env, active: true, found: ["x"] })).toBe(false); });
});

describe("runs", () => {
  it("RunStep", () => {
    expect(ok(S.RunStep, { index: 0, status: "ok" })).toBe(true);
    expect(ok(S.RunStep, { index: -1, status: "ok" })).toBe(false);
  });
  it("RunProgress", () => {
    const base = { ...env, runId: RUN, status: "running", total: 2, steps: [{ index: 0, status: "ok" }] };
    expect(ok(S.RunProgress, { ...base, source: { kind: "scene", sceneId: SCN } })).toBe(true);
    expect(ok(S.RunProgress, { ...base, source: { kind: "test" } })).toBe(true);
    expect(ok(S.RunProgress, { ...base, source: { kind: "rule" } })).toBe(false);
    expect(ok(S.RunProgress, { ...base, source: { kind: "test" }, total: 0 })).toBe(false);
  });
});

describe("HubEvent", () => {
  const b = { ...env, id: EVT, hubId: H };
  const evs: unknown[] = [
    { type: "device.found", deviceId: D, model: "TS011F", vendor: "Tuya" }, { type: "device.removed", deviceId: D },
    { type: "device.online", deviceId: D }, { type: "device.offline", deviceId: D },
    { type: "rule.fired", ruleId: RULE, runId: RUN, result: "ok" }, { type: "rule.broken", ruleId: RULE, reason: "x" },
    { type: "scene.run", sceneId: SCN, runId: RUN, result: "partial" },
    { type: "notify", title: "t", level: "warning" }, { type: "set.rejected", deviceId: D, reason: "r" },
    { type: "config.applied", ruleIds: [RULE], sceneIds: [SCN], rev: 3 }, { type: "hub.warning", code: "c", message: "m" },
  ];
  it.each(evs.map((e) => [(e as { type: string }).type, e]))("%s valid", (_n, e) => { expect(ok(S.HubEvent, { ...b, ...(e as object) })).toBe(true); });
  it("invalid", () => {
    expect(ok(S.HubEvent, { ...b, type: "nope" })).toBe(false);
    expect(ok(S.HubEvent, { ...b, type: "device.found", deviceId: D })).toBe(false);
    expect(ok(S.HubEvent, { ...b, id: D, type: "device.online", deviceId: D })).toBe(false);
  });
});
