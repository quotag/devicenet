import { describe, expect, it } from "vitest";
import { CommandFailedError, HubOfflineError, HubTimeoutError } from "./errors";

describe("transport errors", () => {
  it("carry context and names", () => {
    const t = new HubTimeoutError("hub_a", "cmd_1");
    expect(t).toBeInstanceOf(Error);
    expect(t.name).toBe("HubTimeoutError");
    expect(t.commandId).toBe("cmd_1");
    const o = new HubOfflineError("hub_a", "dev_a");
    expect(o.name).toBe("HubOfflineError");
    expect(o.deviceId).toBe("dev_a");
    const ack = { v: 1 as const, ts: 1, seq: 1, id: "cmd_1", ok: false, error: "busy" as const };
    const f = new CommandFailedError(ack);
    expect(f.code).toBe("busy");
    expect(f.ack).toBe(ack);
    expect(f.message).toContain("busy");
  });
});
