import { describe, expect, it } from "vitest";
import { ClockOffset } from "./clockOffset";

const NOW = 1_700_000_000_000;

describe("ClockOffset", () => {
  it("is 0 without samples", () => {
    const c = new ClockOffset();
    expect(c.offset).toBe(0);
    expect(c.hasSample).toBe(false);
    expect(c.now(NOW)).toBe(NOW);
  });

  it("uses a retained sample as provisional until a live one arrives", () => {
    const c = new ClockOffset();
    c.addSample(NOW - 25_000, NOW, true); // stale retained heartbeat
    expect(c.offset).toBe(-25_000);
    expect(c.isLive).toBe(false);
    c.addSample(NOW + 200, NOW, false);
    expect(c.offset).toBe(200);
    expect(c.isLive).toBe(true);
    // later retained samples are ignored once live data exists
    c.addSample(NOW - 30_000, NOW, true);
    expect(c.offset).toBe(200);
  });

  it("takes the median of the last 5 live samples", () => {
    const c = new ClockOffset();
    for (const s of [100, 900, 120, 110, 5_000]) c.addSample(NOW + s, NOW, false);
    expect(c.offset).toBe(120); // sorted 100,110,120,900,5000
    c.addSample(NOW + 130, NOW, false); // drops 100 → 110,120,130,900,5000
    expect(c.offset).toBe(130);
    expect(c.now(NOW)).toBe(NOW + 130);
  });

  it("averages the two middle samples for an even count", () => {
    const c = new ClockOffset();
    c.addSample(NOW + 100, NOW, false);
    c.addSample(NOW + 300, NOW, false);
    expect(c.offset).toBe(200);
  });

  it("ignores LWT ts 0 and invalid ts", () => {
    const c = new ClockOffset();
    c.addSample(0, NOW, true);
    c.addSample(Number.NaN, NOW, false);
    expect(c.hasSample).toBe(false);
  });

  it("reset() clears samples", () => {
    const c = new ClockOffset();
    c.addSample(NOW + 50, NOW, false);
    c.reset();
    expect(c.hasSample).toBe(false);
    expect(c.offset).toBe(0);
  });
});
