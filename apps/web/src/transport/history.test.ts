import { describe, expect, it, vi } from "vitest";
import type { CommandAck } from "@devicenet/shared";
import { createHistorySource, CloudHistorySource, LanHistorySource, parsePoints } from "./HistorySource";

const q = { hubId: "hub_1" as never, deviceId: "dev_1" as never, property: "power", from: 1000, to: 2000, step: 300 };
const ack = (o: Partial<CommandAck>) => ({ v: 1, id: "cmd_1", ts: 1, seq: 0, ok: true, ...o }) as CommandAck;

describe("HistorySource", () => {
  it("selects LAN source in lan mode and calls /api/history", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ points: [[2, 5], [1, 4]] }) });
    const sendCommand = vi.fn();
    const src = createHistorySource("lan", { sendCommand, fetchImpl: fetchImpl as never });
    expect(src).toBeInstanceOf(LanHistorySource);
    expect(await src.get(q)).toEqual([[1, 4], [2, 5]]);
    expect(fetchImpl.mock.calls[0]![0]).toBe("/api/history/dev_1/power?from=1000&to=2000&step=300");
    expect(sendCommand).not.toHaveBeenCalled();
  });

  it("selects cloud source in cloud mode and sends history.get", async () => {
    const sendCommand = vi.fn().mockResolvedValue(ack({ result: { points: [[1, 2]] } }));
    const fetchImpl = vi.fn();
    const src = createHistorySource("cloud", { sendCommand, fetchImpl: fetchImpl as never });
    expect(src).toBeInstanceOf(CloudHistorySource);
    expect(await src.get(q)).toEqual([[1, 2]]);
    expect(sendCommand).toHaveBeenCalledWith("hub_1", { type: "history.get", deviceId: "dev_1", property: "power", from: 1000, to: 2000, step: 300 });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("empty or malformed data yields no points; failures reject", async () => {
    expect(parsePoints(undefined)).toEqual([]);
    expect(parsePoints([[1, "x"], "bad", [2, 3]])).toEqual([[2, 3]]);
    const empty = new CloudHistorySource(async () => ack({}));
    expect(await empty.get(q)).toEqual([]);
    const bad = new CloudHistorySource(async () => ack({ ok: false, error: "timeout" }));
    await expect(bad.get(q)).rejects.toThrow();
    const lanBad = new LanHistorySource("", (async () => ({ ok: false, status: 500 })) as never);
    await expect(lanBad.get(q)).rejects.toThrow();
  });
});
