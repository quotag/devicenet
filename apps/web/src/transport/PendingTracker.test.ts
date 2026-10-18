import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SET_CONFIRM_TIMEOUT_MS, type PropertyMap } from "@devicenet/shared";
import { PendingTracker, valueMatches, type PendingSnapshot } from "./PendingTracker";

const props: PropertyMap = {
  state: { key: "state", label: "Trạng thái", access: "rw", category: "control", type: "binary" },
  brightness: { key: "brightness", label: "Độ sáng", access: "rw", category: "control", type: "numeric", min: 0, max: 254 },
  power: { key: "power", label: "Công suất", access: "rw", category: "config", type: "numeric", precision: 2 },
  mode: { key: "mode", label: "Chế độ", access: "rw", category: "config", type: "enum", values: ["on", "off", "previous"] },
};

function setup(timeoutMs?: number) {
  const onTimeout = vi.fn<(deviceId: string, keys: string[]) => void>();
  const snaps: PendingSnapshot[] = [];
  const t = new PendingTracker({ timeoutMs, onTimeout, onChange: (s) => snaps.push(s) });
  return { t, onTimeout, snaps };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("valueMatches", () => {
  it("binary and enum/text strict", () => {
    expect(valueMatches(props.state, true, true)).toBe(true);
    expect(valueMatches(props.state, true, 1)).toBe(false);
    expect(valueMatches(props.state, true, "ON")).toBe(false);
    expect(valueMatches(props.mode, "on", "on")).toBe(true);
    expect(valueMatches(props.mode, "on", "On")).toBe(false);
  });

  it("numeric within 10^-precision", () => {
    expect(valueMatches(props.power, 0.38, 0.384)).toBe(true);
    expect(valueMatches(props.power, 0.38, 0.39)).toBe(false);
    expect(valueMatches(props.brightness, 120, 120.4)).toBe(true); // default precision 0 → < 1
    expect(valueMatches(props.brightness, 120, 121)).toBe(false);
    expect(valueMatches(props.brightness, 120, "120")).toBe(false);
  });
});

describe("PendingTracker", () => {
  it("clears a key when state matches, keeps it when not", () => {
    const { t, onTimeout } = setup();
    t.register("dev_a", { state: true, brightness: 200 }, props);
    t.onState({ deviceId: "dev_a", values: { state: true, brightness: 10 } });
    expect(t.isPending("dev_a", "state")).toBe(false);
    expect(t.isPending("dev_a", "brightness")).toBe(true);
    vi.advanceTimersByTime(SET_CONFIRM_TIMEOUT_MS);
    expect(onTimeout).toHaveBeenCalledWith("dev_a", ["brightness"]);
    expect(t.snapshot()).toEqual({});
  });

  it("emits snapshots for the store", () => {
    const { t, snaps } = setup();
    t.register("dev_a", { state: true }, props);
    expect(snaps.at(-1)).toEqual({ dev_a: { state: true } });
    t.onState({ deviceId: "dev_a", values: { state: true } });
    expect(snaps.at(-1)).toEqual({});
    expect(t.get("dev_a")).toBeUndefined();
  });

  it("3 rapid toggles on 3 devices → independent clear/rollback (spec §9)", () => {
    const { t, onTimeout } = setup();
    t.register("dev_a", { state: true }, props);
    vi.advanceTimersByTime(100);
    t.register("dev_b", { state: true }, props);
    vi.advanceTimersByTime(100);
    t.register("dev_c", { state: false }, props);

    t.onState({ deviceId: "dev_a", values: { state: true } }); // confirmed
    t.onState({ deviceId: "dev_b", values: { state: false } }); // stale, not confirmed
    t.onState({ deviceId: "dev_c", values: { state: false } }); // confirmed

    expect(t.snapshot()).toEqual({ dev_b: { state: true } });
    vi.advanceTimersByTime(SET_CONFIRM_TIMEOUT_MS);
    expect(onTimeout).toHaveBeenCalledTimes(1);
    expect(onTimeout).toHaveBeenCalledWith("dev_b", ["state"]);
    expect(t.snapshot()).toEqual({});
  });

  it("re-registering the same key replaces the value and restarts its timer", () => {
    const { t, onTimeout } = setup();
    t.register("dev_a", { state: true }, props);
    vi.advanceTimersByTime(2_000);
    t.register("dev_a", { state: false }, props);
    expect(t.get("dev_a")).toEqual({ state: false });
    vi.advanceTimersByTime(1_500); // 3.5 s since first, 1.5 s since second
    expect(onTimeout).not.toHaveBeenCalled();
    expect(t.isPending("dev_a", "state")).toBe(true);
    // the old value no longer confirms
    t.onState({ deviceId: "dev_a", values: { state: true } });
    expect(t.isPending("dev_a", "state")).toBe(true);
    vi.advanceTimersByTime(1_500);
    expect(onTimeout).toHaveBeenCalledWith("dev_a", ["state"]);
  });

  it("partial re-register keeps the other key on its original timer", () => {
    const { t, onTimeout } = setup();
    t.register("dev_a", { state: true, brightness: 100 }, props);
    vi.advanceTimersByTime(2_000);
    t.register("dev_a", { brightness: 150 }, props);
    vi.advanceTimersByTime(1_000);
    expect(onTimeout).toHaveBeenLastCalledWith("dev_a", ["state"]);
    vi.advanceTimersByTime(2_000);
    expect(onTimeout).toHaveBeenLastCalledWith("dev_a", ["brightness"]);
    expect(onTimeout).toHaveBeenCalledTimes(2);
  });

  it("onRejected clears all keys of the device without timeout callback", () => {
    const { t, onTimeout } = setup();
    t.register("dev_a", { state: true, mode: "on" }, props);
    t.register("dev_b", { state: true }, props);
    expect(t.onRejected("dev_a").sort()).toEqual(["mode", "state"]);
    expect(t.snapshot()).toEqual({ dev_b: { state: true } });
    vi.advanceTimersByTime(SET_CONFIRM_TIMEOUT_MS);
    expect(onTimeout).toHaveBeenCalledTimes(1);
    expect(onTimeout).toHaveBeenCalledWith("dev_b", ["state"]);
  });

  it("timeout is overridable and clear() cancels silently", () => {
    const { t, onTimeout } = setup(500);
    t.register("dev_a", { state: true }, props);
    vi.advanceTimersByTime(500);
    expect(onTimeout).toHaveBeenCalledTimes(1);
    t.register("dev_a", { state: true }, props);
    t.clear();
    vi.advanceTimersByTime(1_000);
    expect(onTimeout).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("confirmed keys cancel their timers", () => {
    const { t } = setup();
    t.register("dev_a", { state: true }, props);
    t.onState({ deviceId: "dev_a", values: { state: true } });
    expect(vi.getTimerCount()).toBe(0);
  });
});
