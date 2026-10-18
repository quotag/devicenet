// @vitest-environment node
/**
 * Transport integration tests over a real in-process broker (aedes), research R13 / spec §9.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ulid } from "ulid";
import { topics, type Device, type DeviceId, type HubId, type TenantId } from "@devicenet/shared";
import { startBroker, type TestBroker } from "../../test/aedes";
import { FakeHub, type FakeHubOptions } from "../../test/fakeHub";
import { configStore, connectionStore, deviceStateStore, resetAll, toastStore } from "@/stores";
import { MqttClient, backoffDelay } from "./MqttClient";
import { HubCommands, SetValidationError } from "./HubCommands";
import { createInbound, type Inbound } from "./inbound";
import { CommandFailedError, HubOfflineError, HubTimeoutError } from "./errors";

const tenant = `tenant_${ulid()}` as TenantId;
const hub = `hub_${ulid()}` as HubId;
const devA = `dev_${ulid()}` as DeviceId;
const devB = `dev_${ulid()}` as DeviceId;

function device(id: DeviceId, name: string): Device {
  return {
    id,
    hubId: hub,
    siteId: `site_${ulid()}`,
    roomId: null,
    driver: "zigbee2mqtt",
    externalId: `0x${id.slice(-8)}`,
    name,
    icon: "plug",
    properties: {
      state: { key: "state", label: "Trạng thái", access: "rw", category: "control", type: "binary" },
      power: { key: "power", label: "Công suất", access: "r", category: "sensor", type: "numeric" },
      brightness: { key: "brightness", label: "Độ sáng", access: "rw", category: "control", type: "numeric", min: 0, max: 254 },
    },
    status: "active",
    createdAt: 1,
    updatedAt: 1,
  } as Device;
}

async function waitFor(cond: () => boolean, timeoutMs = 3_000, what = "condition"): Promise<void> {
  const start = Date.now();
  while (!cond()) {
    if (Date.now() - start > timeoutMs) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 10));
  }
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface Rig {
  broker: TestBroker;
  hubSim: FakeHub;
  mqtt: MqttClient;
  commands: HubCommands;
  inbound: Inbound;
  subscribes: number;
}

let rig: Rig | null = null;
const extraHubs: FakeHub[] = [];

async function setup(
  hubOpts: Partial<FakeHubOptions> = {},
  brokerOpts: Parameters<typeof startBroker>[0] = {},
  password?: string,
): Promise<Rig> {
  const broker = await startBroker(brokerOpts);
  const hubSim = await FakeHub.start({ url: broker.url, tenantId: tenant, hubId: hub, ...hubOpts });
  await hubSim.status(true);
  await hubSim.state(devA, { state: false, power: 0 });
  await hubSim.state(devB, { state: false, power: 0 });

  const r = { broker, hubSim, subscribes: 0 } as Rig;
  let mqtt!: MqttClient;
  const publish = (kind: Parameters<MqttClient["publish"]>[0], topic: string, payload: unknown) =>
    mqtt.publish(kind, topic, payload);
  r.commands = new HubCommands({ tenantId: tenant, publish, by: "uid_test", ackTimeoutMs: 300, setTimeoutMs: 300 });
  r.inbound = createInbound({ tenantId: tenant, commands: r.commands });
  mqtt = new MqttClient({
    url: broker.url,
    tenantId: tenant,
    owner: "uid_test",
    username: "uid_test",
    password,
    backoffMinMs: 50,
    backoffMaxMs: 200,
    onMessage: (t, p, retained) => r.inbound.handle(t, p, retained),
  });
  r.mqtt = mqtt;
  countSubscribes(r);
  mqtt.start();
  rig = r;
  return r;
}

function countSubscribes(r: Rig) {
  r.broker.broker.on("subscribe", (subs, client) => {
    if (client?.id === r.mqtt.clientId && subs.some((s) => s.topic === topics.tenantWildcard(tenant))) r.subscribes++;
  });
}

beforeEach(() => {
  resetAll();
  configStore.getState().setDevices({ [devA]: device(devA, "Đèn bàn"), [devB]: device(devB, "Ổ cắm") });
});

afterEach(async () => {
  if (rig) {
    rig.commands.dispose();
    await rig.mqtt.end();
    await rig.hubSim.stop().catch(() => {});
    await rig.broker.stop();
    rig = null;
  }
  for (const h of extraHubs.splice(0)) await h.stop().catch(() => {});
  vi.restoreAllMocks();
});

describe("MqttClient + inbound", () => {
  it("retained replay fills stores right after subscribe", async () => {
    const r = await setup();
    await waitFor(() => Object.keys(deviceStateStore.getState().byId).length === 2, 3_000, "retained state");
    expect(connectionStore.getState().mqtt).toBe("online");
    expect(connectionStore.getState().hubStatus[hub]?.online).toBe(true);
    expect(connectionStore.getState().clockOffset[hub]).toBeTypeOf("number");
    expect(deviceStateStore.getState().byId[devA]?.values.state).toBe(false);
    expect(r.subscribes).toBe(1);
  });

  it("subscribes once per connect and again after broker restart", async () => {
    const r = await setup();
    await waitFor(() => r.subscribes === 1);
    await sleep(100);
    expect(r.subscribes).toBe(1);

    const port = r.broker.port;
    await r.hubSim.stop();
    await r.broker.stop();
    await waitFor(() => connectionStore.getState().mqtt !== "online", 2_000, "disconnect");

    r.broker = await startBroker({ port });
    r.subscribes = 0;
    countSubscribes(r);
    await waitFor(() => r.subscribes === 1, 3_000, "resubscribe");
    expect(connectionStore.getState().mqtt).toBe("online");

    // New broker has no retained data: the hub republishes and the app picks it up.
    r.hubSim = await FakeHub.start({ url: r.broker.url, tenantId: tenant, hubId: hub, now: () => Date.now() + 120_000 });
    await r.hubSim.state(devA, { state: true });
    await waitFor(() => deviceStateStore.getState().byId[devA]?.values.state === true, 2_000, "state after restart");
    expect(r.subscribes).toBe(1);
  });

  it("drops malformed payloads with a warning", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const r = await setup();
    await waitFor(() => deviceStateStore.getState().byId[devA] !== undefined);
    const topic = topics.state(tenant, hub, devA);
    await r.hubSim.publishRaw("state", topic, "{not json", false);
    await r.hubSim.publishRaw("state", topic, JSON.stringify({ v: 1, ts: Date.now(), seq: 999, deviceId: devA }), false);
    await waitFor(() => warn.mock.calls.length >= 2, 2_000, "warnings");
    expect(deviceStateStore.getState().byId[devA]?.values.state).toBe(false);
    // still alive afterwards
    await r.hubSim.state(devA, { state: true });
    await waitFor(() => deviceStateStore.getState().byId[devA]?.values.state === true);
  });

  it("drops stale seq; accepts reset seq after hub reboot (ts + 60 s); empty retained removes", async () => {
    const r = await setup();
    await waitFor(() => deviceStateStore.getState().byId[devA] !== undefined);
    const topic = topics.state(tenant, hub, devA);
    const base = deviceStateStore.getState().byId[devA]!;
    const old = { ...base, seq: 1, values: { state: true } };
    await r.hubSim.publishRaw("state", topic, JSON.stringify(old), false);
    await sleep(100);
    expect(deviceStateStore.getState().byId[devA]?.values.state).toBe(false);

    const rebooted = { ...base, seq: 0, ts: base.ts + 61_000, values: { state: true } };
    await r.hubSim.publishRaw("state", topic, JSON.stringify(rebooted), false);
    await waitFor(() => deviceStateStore.getState().byId[devA]?.values.state === true, 2_000, "rebooted state");

    await r.hubSim.clearState(devA);
    await waitFor(() => deviceStateStore.getState().byId[devA] === undefined, 2_000, "removal");
  });

  it("accepts the LWT status even though its seq/ts are 0", async () => {
    const r = await setup();
    await waitFor(() => connectionStore.getState().hubStatus[hub]?.online === true);
    await r.hubSim.publishRaw(
      "status",
      topics.status(tenant, hub),
      JSON.stringify({ v: 1, ts: 0, seq: 0, online: false, agentVersion: "", z2m: "offline" }),
    );
    await waitFor(() => connectionStore.getState().hubStatus[hub]?.online === false, 2_000, "LWT");
    await expect(r.commands.setValues(devA, { state: true })).rejects.toBeInstanceOf(HubOfflineError);
  });

  it("setPassword keeps the connection; the next CONNECT uses the new token (spec §9)", async () => {
    const seen: string[] = [];
    const authenticate = (_c: unknown, _u: unknown, pw: Buffer | undefined, done: (e: null, ok: boolean) => void) => {
      seen.push(pw?.toString() ?? "");
      done(null, true);
    };
    const r = await setup({}, { authenticate: authenticate as never }, "token-1");
    await waitFor(() => r.mqtt.connected);
    r.mqtt.setPassword("token-2");
    await sleep(150);
    expect(r.mqtt.connected).toBe(true);
    expect(connectionStore.getState().mqtt).toBe("online");
    expect(seen.filter((p) => p.startsWith("token-"))).toEqual(["token-1"]);

    const port = r.broker.port;
    await r.hubSim.stop();
    await r.broker.stop();
    const seen2: string[] = [];
    r.broker = await startBroker({
      port,
      authenticate: ((_c: unknown, _u: unknown, pw: Buffer | undefined, done: (e: null, ok: boolean) => void) => {
        seen2.push(pw?.toString() ?? "");
        done(null, true);
      }) as never,
    });
    await waitFor(() => r.mqtt.connected && seen2.length > 0, 3_000, "reconnect");
    expect(seen2).toEqual(["token-2"]);
    r.hubSim = await FakeHub.start({ url: r.broker.url, tenantId: tenant, hubId: hub });
  });
});

describe("HubCommands", () => {
  it("toggle round-trip: pending then cleared by echoed state", async () => {
    const r = await setup();
    await waitFor(() => deviceStateStore.getState().byId[devA] !== undefined);
    const p = r.commands.setValues(devA, { state: true });
    expect(deviceStateStore.getState().pending[devA]?.state?.value).toBe(true);
    await p;
    await waitFor(() => deviceStateStore.getState().pending[devA] === undefined, 2_000, "pending cleared");
    expect(deviceStateStore.getState().byId[devA]?.values.state).toBe(true);
    expect(r.hubSim.sets[0]).toEqual({ deviceId: devA, cmd: { v: 1, values: { state: true }, by: "uid_test" } });
    expect(toastStore.getState().current).toBeNull();
  });

  it("no echo → rollback + timeout toast; other device unaffected", async () => {
    const r = await setup({ echoSet: false });
    await waitFor(() => Object.keys(deviceStateStore.getState().byId).length === 2);
    await r.commands.setValues(devA, { state: true });
    await r.commands.setValues(devB, { state: true });
    await r.hubSim.state(devB, { state: true }); // only B confirms
    await waitFor(() => deviceStateStore.getState().pending[devB] === undefined);
    expect(deviceStateStore.getState().pending[devA]?.state).toBeDefined();
    await waitFor(() => deviceStateStore.getState().pending[devA] === undefined, 2_000, "rollback");
    expect(deviceStateStore.getState().byId[devA]?.values.state).toBe(false);
    expect(toastStore.getState().current).toMatchObject({ kind: "timeout" });
    expect(toastStore.getState().current?.text).toContain("Đèn bàn");
  });

  it("set.rejected event drops pending and shows an error toast", async () => {
    const r = await setup({ echoSet: false });
    await waitFor(() => deviceStateStore.getState().byId[devA] !== undefined);
    await r.commands.setValues(devA, { brightness: 100 });
    await r.hubSim.event({ id: `evt_${ulid()}`, type: "set.rejected", deviceId: devA, reason: "driver" });
    await waitFor(() => deviceStateStore.getState().pending[devA] === undefined, 1_000, "rejected");
    expect(toastStore.getState().current).toMatchObject({ kind: "error" });
  });

  it("validates locally and refuses offline devices", async () => {
    const r = await setup();
    await waitFor(() => deviceStateStore.getState().byId[devA] !== undefined);
    await expect(r.commands.setValues(devA, { power: 5 })).rejects.toBeInstanceOf(SetValidationError);
    await expect(r.commands.setValues(devA, { brightness: 999 })).rejects.toBeInstanceOf(SetValidationError);
    await expect(r.commands.setValues(devA, { state: "on" })).rejects.toBeInstanceOf(SetValidationError);
    await r.hubSim.state(devB, {}, { online: false });
    await waitFor(() => deviceStateStore.getState().byId[devB]?.online === false);
    await expect(r.commands.setValues(devB, { state: true })).rejects.toBeInstanceOf(HubOfflineError);
    expect(deviceStateStore.getState().pending).toEqual({});
    expect(r.hubSim.sets).toEqual([]);
  });

  it("pairing.start resolves with ack; countdown source is retained pairing", async () => {
    const expiresAt = Date.now() + 120_000;
    const r = await setup({
      onCommand: async (env, h) => {
        if (env.cmd.type !== "pairing.start") return { ok: true };
        await h.pairing({ active: true, startedAt: Date.now(), expiresAt });
        return { ok: true, result: { expiresAt } };
      },
    });
    await waitFor(() => r.mqtt.connected);
    const ack = await r.commands.sendCommand(hub, { type: "pairing.start", seconds: 120 });
    expect(ack.ok).toBe(true);
    expect(ack.result).toEqual({ expiresAt });
    expect(r.hubSim.commands[0]?.id).toMatch(/^cmd_[0-9A-HJKMNP-TV-Z]{26}$/);
    expect(r.hubSim.commands[0]?.by).toBe("uid_test");
    await waitFor(() => connectionStore.getState().pairing[hub]?.active === true, 2_000, "pairing");
    expect(connectionStore.getState().pairing[hub]?.expiresAt).toBe(expiresAt);
  });

  it("app opening after pairing already started sees retained pairing", async () => {
    const broker = await startBroker();
    const other = await FakeHub.start({ url: broker.url, tenantId: tenant, hubId: hub });
    extraHubs.push(other);
    await other.pairing({ active: true, expiresAt: Date.now() + 60_000 });
    const commands = new HubCommands({ tenantId: tenant, publish: () => Promise.resolve() });
    const inbound = createInbound({ tenantId: tenant, commands });
    const mqtt = new MqttClient({
      url: broker.url,
      tenantId: tenant,
      owner: "lan",
      onMessage: (t, p, ret) => inbound.handle(t, p, ret),
    });
    mqtt.start();
    try {
      await waitFor(() => connectionStore.getState().pairing[hub]?.active === true, 2_000, "retained pairing");
      expect(mqtt.clientId).toMatch(/^web-lan-[0-9A-HJKMNP-TV-Z]{26}$/);
    } finally {
      commands.dispose();
      await mqtt.end();
      await other.stop();
      extraHubs.length = 0;
      await broker.stop();
    }
  });

  it("no ack → HubTimeoutError; ok:false → CommandFailedError", async () => {
    const r = await setup({
      onCommand: (env) => (env.cmd.type === "device.ping" ? null : { ok: false, error: "busy" }),
    });
    await waitFor(() => r.mqtt.connected);
    await expect(r.commands.sendCommand(hub, { type: "device.ping", deviceId: devA })).rejects.toBeInstanceOf(
      HubTimeoutError,
    );
    const err = await r.commands.sendCommand(hub, { type: "pairing.stop" }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(CommandFailedError);
    expect((err as CommandFailedError).code).toBe("busy");
  });
});

describe("backoffDelay", () => {
  it("1 s doubling to a 10 s cap", () => {
    expect([0, 1, 2, 3, 4, 5].map((n) => backoffDelay(n))).toEqual([1_000, 2_000, 4_000, 8_000, 10_000, 10_000]);
  });
});
