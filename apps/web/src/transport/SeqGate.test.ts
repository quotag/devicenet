import { describe, expect, it } from "vitest";
import { SeqGate, REBOOT_WINDOW_MS } from "./SeqGate";

const T = "t/ten_a/h/hub_a/d/dev_a/state";
const T2 = "t/ten_a/h/hub_a/d/dev_b/state";

describe("SeqGate", () => {
  it("accepts the first message of a topic", () => {
    expect(new SeqGate().accept(T, 7, 1_000)).toBe(true);
  });

  it("accepts increasing seq, drops duplicates and out-of-order", () => {
    const g = new SeqGate();
    expect(g.accept(T, 5, 1_000)).toBe(true);
    expect(g.accept(T, 5, 1_000)).toBe(false); // QoS1 duplicate / retained replay
    expect(g.accept(T, 6, 2_000)).toBe(true);
    expect(g.accept(T, 4, 2_500)).toBe(false); // older seq arriving late
    expect(g.accept(T, 7, 3_000)).toBe(true);
  });

  it("keys by full topic", () => {
    const g = new SeqGate();
    expect(g.accept(T, 10, 1_000)).toBe(true);
    expect(g.accept(T2, 3, 1_000)).toBe(true);
    expect(g.accept(T2, 3, 1_000)).toBe(false);
  });

  it("accepts a reset seq after hub reboot only when ts > lastTs + 60 s", () => {
    const g = new SeqGate();
    const t0 = 1_700_000_000_000;
    expect(g.accept(T, 500, t0)).toBe(true);
    expect(g.accept(T, 0, t0 + REBOOT_WINDOW_MS)).toBe(false); // exactly 60 s: not greater
    expect(g.accept(T, 0, t0 + REBOOT_WINDOW_MS + 1)).toBe(true);
    // after reboot the new sequence continues normally
    expect(g.accept(T, 1, t0 + REBOOT_WINDOW_MS + 2)).toBe(true);
    expect(g.accept(T, 1, t0 + REBOOT_WINDOW_MS + 2)).toBe(false);
  });

  it("reset() and forget() clear history", () => {
    const g = new SeqGate();
    g.accept(T, 5, 1_000);
    g.accept(T2, 5, 1_000);
    g.forget(T);
    expect(g.accept(T, 5, 1_000)).toBe(true);
    expect(g.accept(T2, 5, 1_000)).toBe(false);
    g.reset();
    expect(g.accept(T2, 5, 1_000)).toBe(true);
  });
});
