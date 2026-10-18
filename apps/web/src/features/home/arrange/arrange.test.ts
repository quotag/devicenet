import { afterEach, beforeEach, describe, expect, it, vi as vitest } from "vitest";
import { Layout, type DeviceId, type SiteId } from "@devicenet/shared";
import { configStore, resetAll } from "@/stores";
import { bumpLayout, deriveTiles, moveTile, orderOf, packTiles, reflow, resizeTile, withFilter } from "./layoutModel";
import { SAVE_DEBOUNCE_MS, createLayoutSaver } from "./layoutSaver";

const id = (c: string) => `dev_01HZZZZZZZZZZZZZZZZZZZZZZ${c}` as DeviceId;
const siteId = "site_01HZZZZZZZZZZZZZZZZZZZZZZZ" as SiteId;
const [A, B, C, D] = ["A", "B", "C", "D"].map(id) as [DeviceId, DeviceId, DeviceId, DeviceId];
const tiles = [A, B, C, D].map((i) => ({ id: i, w: 1 as const }));

describe("layoutModel", () => {
  it("packs row-major; 2×1 that does not fit wraps", () => {
    const r = packTiles([{ id: A, w: 1 }, { id: B, w: 2 }, { id: C, w: 1 }], 2);
    expect(r[A]).toEqual({ x: 0, y: 0, w: 1, h: 1 });
    expect(r[B]).toEqual({ x: 0, y: 1, w: 2, h: 1 });
    expect(r[C]).toEqual({ x: 0, y: 2, w: 1, h: 1 });
  });

  it("reorder produces a valid Layout with the new order", () => {
    const moved = moveTile(tiles, D, A);
    expect(moved.map((t) => t.id)).toEqual([D, A, B, C]);
    const l = withFilter(undefined, siteId, "all", moved);
    expect(() => Layout.parse(l)).not.toThrow();
    expect(orderOf(l.filters.all!.tiles)).toEqual([D, A, B, C]);
  });

  it("resize toggles 1×1 ↔ 2×1 and keeps a valid Layout", () => {
    const r1 = resizeTile(tiles, B);
    expect(r1.find((t) => t.id === B)!.w).toBe(2);
    expect(resizeTile(r1, B).find((t) => t.id === B)!.w).toBe(1);
    expect(resizeTile(r1, B, 2).find((t) => t.id === B)!.w).toBe(2);
    const l = withFilter(undefined, siteId, "all", r1);
    expect(Layout.parse(l).filters.all!.tiles[B]).toEqual({ x: 0, y: 1, w: 2, h: 1 });
  });

  it("keeps other filters and derives widths from stored rects", () => {
    const base = withFilter(undefined, siteId, "room_x", [{ id: A, w: 2 }]);
    const l = withFilter(base, siteId, "all", tiles);
    expect(Object.keys(l.filters).sort()).toEqual(["all", "room_x"]);
    expect(deriveTiles([{ id: A }, { id: B }], l, "room_x")).toEqual([
      { id: A, w: 2 },
      { id: B, w: 1 },
    ]);
  });

  it("reflows 2 → 4 cols preserving order", () => {
    const entry = { cols: 2, tiles: packTiles([{ id: A, w: 2 }, { id: B, w: 1 }, { id: C, w: 1 }, { id: D, w: 2 }], 2) };
    const r = reflow(entry, 4);
    expect(r.cols).toBe(4);
    expect(r.tiles[A]).toEqual({ x: 0, y: 0, w: 2, h: 1 });
    expect(r.tiles[B]).toEqual({ x: 2, y: 0, w: 1, h: 1 });
    expect(r.tiles[C]).toEqual({ x: 3, y: 0, w: 1, h: 1 });
    expect(r.tiles[D]).toEqual({ x: 0, y: 1, w: 2, h: 1 });
    expect(orderOf(r.tiles)).toEqual([A, B, C, D]);
    expect(reflow(entry, 2)).toBe(entry);
  });

  it("bump: rev + 1, updatedAt", () => {
    const l = { ...withFilter(undefined, siteId, "all", tiles), rev: 4 };
    expect(bumpLayout(l, 99)).toMatchObject({ rev: 5, updatedAt: 99 });
  });
});

describe("layoutSaver", () => {
  beforeEach(() => {
    resetAll();
    vitest.useFakeTimers();
  });
  afterEach(() => vitest.useRealTimers());

  it("applies locally at once, writes once after 500 ms quiet with rev + 1", async () => {
    const save = vitest.fn(async (_l: Layout) => undefined);
    const s = createLayoutSaver(save, { now: () => 1234 });
    s.update(siteId, "all", tiles);
    expect(orderOf(configStore.getState().layouts[siteId]!.filters.all!.tiles)).toEqual([A, B, C, D]);
    await vitest.advanceTimersByTimeAsync(SAVE_DEBOUNCE_MS - 100);
    s.update(siteId, "all", moveTile(tiles, D, A));
    await vitest.advanceTimersByTimeAsync(SAVE_DEBOUNCE_MS - 1);
    expect(save).not.toHaveBeenCalled();
    await vitest.advanceTimersByTimeAsync(1);
    expect(save).toHaveBeenCalledTimes(1);
    const written = save.mock.calls[0]![0];
    expect(written).toMatchObject({ siteId, rev: 1, updatedAt: 1234 });
    expect(orderOf(written.filters.all!.tiles)).toEqual([D, A, B, C]);
    expect(configStore.getState().layouts[siteId]!.rev).toBe(1);

    s.update(siteId, "all", tiles);
    await s.flush();
    expect(save).toHaveBeenCalledTimes(2);
    expect(save.mock.calls[1]![0].rev).toBe(2);
    await vitest.advanceTimersByTimeAsync(SAVE_DEBOUNCE_MS * 2);
    expect(save).toHaveBeenCalledTimes(2);
  });
});
