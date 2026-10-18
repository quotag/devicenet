import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { topics, type Device, type DeviceId, type DeviceState, type HubId, type TenantId } from "@devicenet/shared";
import { configStore, deviceStateStore, resetAll } from "@/stores";
import { createFakeTransport } from "../../test/fakeTransport";
import { TransportProvider } from "./TransportProvider";
import { createTransport, type Transport, type TransportMqtt } from "./index";
import type { MqttClientOptions } from "./MqttClient";
import type { ConfigSource } from "./ConfigSource";
import { useConnection, useConfigWrites, useDeviceState, useDevices, usePairing, useSetValues } from "./hooks";

const cloudImports = vi.hoisted(() => ({ firestore: 0, writes: 0 }));
vi.mock("./cloud/FirestoreConfigSource", () => {
  cloudImports.firestore++;
  return { FirestoreConfigSource: class {} };
});
vi.mock("./writes", () => {
  cloudImports.writes++;
  return {};
});

const tenant = "tenant_01HZZZZZZZZZZZZZZZZZZZZZZZ" as TenantId;
const hub = "hub_01HZZZZZZZZZZZZZZZZZZZZZZZ" as HubId;
const site = "site_01HZZZZZZZZZZZZZZZZZZZZZZZ";
const devA = "dev_01HZZZZZZZZZZZZZZZZZZZZZZA" as DeviceId;
const devB = "dev_01HZZZZZZZZZZZZZZZZZZZZZZB" as DeviceId;

function device(id: DeviceId, createdAt: number): Device {
  return {
    id,
    hubId: hub,
    siteId: site,
    roomId: null,
    driver: "zigbee2mqtt",
    externalId: `0x${id.slice(-4)}`,
    name: id,
    icon: "plug",
    properties: {
      state: { key: "state", label: "Trạng thái", access: "rw", category: "control", type: "binary" },
    },
    status: "active",
    createdAt,
    updatedAt: createdAt,
  } as Device;
}

class FakeMqtt implements TransportMqtt {
  published: { kind: string; topic: string; payload: unknown }[] = [];
  passwords: string[] = [];
  started = false;
  ended = false;
  constructor(readonly opts: MqttClientOptions) {}
  start() {
    this.started = true;
  }
  async end() {
    this.ended = true;
  }
  setPassword(t: string) {
    this.passwords.push(t);
  }
  async publish(kind: string, topic: string, payload: unknown) {
    this.published.push({ kind, topic, payload });
  }
  /** Simulate an inbound broker message. */
  deliver(topic: string, payload: unknown, retained = false) {
    this.opts.onMessage(topic, new TextEncoder().encode(JSON.stringify(payload)), retained);
  }
}

const nullConfig = (): ConfigSource & { started: string | null; stopped: boolean } => ({
  started: null,
  stopped: false,
  start(t: string) {
    this.started = t;
  },
  stop() {
    this.stopped = true;
  },
  ready: Promise.resolve(),
});

let seq = 0;
function state(id: DeviceId, on: boolean, ts = Date.now()): DeviceState {
  return { v: 1, ts, seq: ++seq, deviceId: id, online: true, lastSeen: ts, values: { state: on }, at: { state: ts } };
}
function status(ts: number) {
  return { v: 1, ts, seq: ++seq, online: true, agentVersion: "1.0.0", z2m: "online" };
}

let mqtt: FakeMqtt;
let transport: Transport;

async function lanTransport(): Promise<Transport> {
  const t = await createTransport(
    "lan",
    { tenantId: tenant },
    { config: nullConfig(), createMqtt: (o) => (mqtt = new FakeMqtt(o)) },
  );
  transport = t;
  return t;
}

const wrap =
  (t: Transport) =>
  ({ children }: { children: ReactNode }) => <TransportProvider transport={t}>{children}</TransportProvider>;

beforeEach(() => {
  resetAll();
  configStore.getState().setDevices({ [devA]: device(devA, 2), [devB]: device(devB, 1) });
  configStore.getState().setHubs({
    [hub]: { id: hub, siteId: site, name: "Hub", claimedAt: 1, claimedBy: "u", online: true, lastSeen: 1, drivers: [] },
  } as never);
});

afterEach(async () => {
  vi.useRealTimers();
  await transport?.dispose();
});

describe("createTransport", () => {
  it("LAN: no firebase, writes null, ws://host:9001, no auth, by:lan", async () => {
    const config = nullConfig();
    const t = await createTransport("lan", { tenantId: tenant, uid: "u1", idToken: "tok" }, {
      config,
      createMqtt: (o) => (mqtt = new FakeMqtt(o)),
    });
    transport = t;
    expect(cloudImports).toEqual({ firestore: 0, writes: 0 });
    expect(t.writes).toBeNull();
    expect(t.mode).toBe("lan");
    expect(mqtt.opts.url).toBe(`ws://${location.hostname}:9001`);
    expect(mqtt.opts.username).toBeUndefined();
    expect(mqtt.opts.password).toBeUndefined();
    expect(mqtt.started).toBe(true);
    expect(config.started).toBe(tenant);

    mqtt.deliver(topics.state(tenant, hub, devA), state(devA, false), true);
    await t.commands.setValues(devA, { state: true });
    expect(mqtt.published[0]?.topic).toBe(topics.set(tenant, hub, devA));
    expect(mqtt.published[0]?.payload).toMatchObject({ values: { state: true }, by: "lan" });

    await t.dispose();
    expect(config.stopped).toBe(true);
    expect(mqtt.ended).toBe(true);
  });

  it("cloud: username=uid, password=idToken, setPassword without reconnect", async () => {
    const writes = { updateDevicePresentation: vi.fn(), createRoom: vi.fn(), createSite: vi.fn(), renameHub: vi.fn(), setRuleEnabled: vi.fn(), renameRoom: vi.fn(), deleteRoom: vi.fn(), deleteRule: vi.fn(), deleteScene: vi.fn() };
    transport = await createTransport("cloud", { tenantId: tenant, uid: "u1", idToken: "tok1" }, {
      mqttUrl: "ws://localhost:8084/mqtt",
      config: nullConfig(),
      writes,
      createMqtt: (o) => (mqtt = new FakeMqtt(o)),
    });
    expect(mqtt.opts).toMatchObject({ url: "ws://localhost:8084/mqtt", username: "u1", password: "tok1", owner: "u1" });
    transport.setPassword("tok2");
    expect(mqtt.passwords).toEqual(["tok2"]);
    expect(mqtt.ended).toBe(false);
    const { result } = renderHook(() => useConfigWrites(), { wrapper: wrap(transport) });
    expect(result.current).toBe(writes);
  });
});

describe("hooks", () => {
  it("useDeviceState re-renders only for its own id", async () => {
    const t = await lanTransport();
    mqtt.deliver(topics.state(tenant, hub, devA), state(devA, false), true);
    mqtt.deliver(topics.state(tenant, hub, devB), state(devB, false), true);
    const renders: Record<string, number> = { [devA]: 0, [devB]: 0 };
    function Tile({ id }: { id: DeviceId }) {
      renders[id]!++;
      const s = useDeviceState(id);
      return <span data-testid={id}>{String(s?.values.state)}</span>;
    }
    const { getByTestId } = render(
      <TransportProvider transport={t}>
        <Tile id={devA} />
        <Tile id={devB} />
      </TransportProvider>,
    );
    const a0 = renders[devA]!;
    const b0 = renders[devB]!;
    act(() => mqtt.deliver(topics.state(tenant, hub, devB), state(devB, true)));
    expect(getByTestId(devB).textContent).toBe("true");
    expect(renders[devB]).toBe(b0 + 1);
    // pending on B (via HubCommands → PendingTracker → store) does not touch A either
    await act(() => t.commands.setValues(devB, { state: false }));
    expect(renders[devB]).toBe(b0 + 2);
    expect(renders[devA]).toBe(a0);
  });

  it("merges pending over confirmed and clears on matching state", async () => {
    const t = await lanTransport();
    mqtt.deliver(topics.state(tenant, hub, devA), state(devA, false), true);
    const { result } = renderHook(() => ({ s: useDeviceState(devA), set: useSetValues() }), { wrapper: wrap(t) });
    expect(result.current.s?.values.state).toBe(false);
    await act(() => result.current.set(devA, { state: true }));
    expect(result.current.s?.values.state).toBe(true);
    expect(result.current.s?.pending.has("state")).toBe(true);
    expect(deviceStateStore.getState().byId[devA]?.values.state).toBe(false);
    act(() => mqtt.deliver(topics.state(tenant, hub, devA), state(devA, true)));
    expect(result.current.s?.values.state).toBe(true);
    expect(result.current.s?.pending.size).toBe(0);
  });

  it("usePairing counts down on the hub clock from a retained pairing (spec §9)", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    vi.setSystemTime(1_000_000_000_000);
    const t = await lanTransport();
    const skew = 7_000; // hub clock is 7 s ahead of the phone
    const hubNow = () => Date.now() + skew;
    mqtt.deliver(topics.status(tenant, hub), status(hubNow()));
    mqtt.deliver(
      topics.pairing(tenant, hub),
      { v: 1, ts: hubNow(), seq: ++seq, active: true, startedAt: hubNow(), expiresAt: hubNow() + 60_000, found: [] },
      true,
    );
    const { result } = renderHook(() => usePairing(hub), { wrapper: wrap(t) });
    expect(result.current.active).toBe(true);
    expect(result.current.remainingMs).toBe(60_000);
    expect(t.hubNow(hub)).toBe(hubNow());
    await act(async () => vi.advanceTimersByTime(10_000));
    expect(result.current.remainingMs).toBe(50_000);
    await act(async () => vi.advanceTimersByTime(50_000));
    expect(result.current.remainingMs).toBe(0);
    expect(result.current.active).toBe(false);
  });
});

describe("fakeTransport", () => {
  it("backs hooks: devices order, sets recorded, command ack/timeout, LAN writes null", async () => {
    const fake = createFakeTransport({
      devices: [device(devA, 2), device(devB, 1)],
      states: [state(devA, false), state(devB, false)],
    });
    transport = fake;
    const { result } = renderHook(
      () => ({ list: useDevices(site as never), conn: useConnection(), set: useSetValues(), a: useDeviceState(devA) }),
      { wrapper: wrap(fake) },
    );
    expect(result.current.list.map((d) => d.id)).toEqual([devB, devA]);
    expect(result.current.conn.mqtt).toBe("online");
    await act(() => result.current.set(devA, { state: true }));
    expect(fake.sets).toEqual([{ deviceId: devA, values: { state: true } }]);
    expect(result.current.a?.pending.has("state")).toBe(true);
    act(() => fake.confirm(devA));
    expect(result.current.a?.values.state).toBe(true);
    expect(result.current.a?.pending.size).toBe(0);

    const p1 = fake.commands.sendCommand(hub, { type: "device.ping", deviceId: devA } as never);
    fake.ack(fake.sent[0]!.id);
    await expect(p1).resolves.toMatchObject({ ok: true });
    const p2 = fake.commands.sendCommand(hub, { type: "device.ping", deviceId: devA } as never);
    fake.timeout(fake.sent[1]!.id);
    await expect(p2).rejects.toMatchObject({ name: "HubTimeoutError" });

    expect(createFakeTransport({ mode: "lan" }).writes).toBeNull();
  });
});
