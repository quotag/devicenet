import type { DeviceId, Layout, RoomId, SiteId } from "@devicenet/shared";

/** One tile in arrange order (D-02: a layout per (site, filter)). */
export interface ArrangeTile {
  id: DeviceId;
  w: 1 | 2;
}

export type LayoutFilter = "all" | RoomId;
type Rect = Layout["filters"][string]["tiles"][string];

/**
 * Ordered tiles for `(site, filter)`.
 * `devices` must already be ordered (layout (y, x), then new devices by `createdAt` — see `useDevices`);
 * widths come from the stored rects and are clamped to `cols`.
 */
export function deriveTiles(
  devices: readonly { id: DeviceId; createdAt?: number }[],
  layout: Layout | undefined,
  filter: LayoutFilter,
  cols = 2,
): ArrangeTile[] {
  const rects = layout?.filters[filter]?.tiles ?? {};
  return devices.map((d) => ({ id: d.id, w: rects[d.id]?.w === 2 && cols >= 2 ? 2 : 1 }));
}

/**
 * Row-major packing identical to CSS grid `auto-flow: row` (no dense): a 2×1 tile that does not fit
 * the rest of a row wraps to the next one. Used both to persist rects and to reflow to another `cols`.
 */
export function packTiles(tiles: readonly ArrangeTile[], cols = 2): Record<DeviceId, Rect> {
  const out: Record<string, Rect> = {};
  let x = 0;
  let y = 0;
  for (const t of tiles) {
    const w = Math.min(t.w, cols) as 1 | 2;
    if (x + w > cols) {
      x = 0;
      y += 1;
    }
    out[t.id] = { x, y, w, h: 1 };
    x += w;
    if (x >= cols) {
      x = 0;
      y += 1;
    }
  }
  return out as Record<DeviceId, Rect>;
}

/** Order of a stored filter entry by (y, x); ids not in `rects` are ignored. */
export function orderOf(rects: Record<string, Rect>): DeviceId[] {
  return (Object.entries(rects) as [DeviceId, Rect][])
    .sort(([, a], [, b]) => a.y - b.y || a.x - b.x)
    .map(([id]) => id);
}

/** Re-pack a stored entry authored for another column count (phone 2 ↔ desktop 4). */
export function reflow(entry: { cols: number; tiles: Record<string, Rect> }, cols: number) {
  if (entry.cols === cols) return entry;
  const tiles = orderOf(entry.tiles).map((id) => ({ id, w: entry.tiles[id]!.w }));
  return { cols, tiles: packTiles(tiles, cols) };
}

export function moveTile(tiles: readonly ArrangeTile[], from: DeviceId, to: DeviceId): ArrangeTile[] {
  const i = tiles.findIndex((t) => t.id === from);
  const j = tiles.findIndex((t) => t.id === to);
  if (i < 0 || j < 0 || i === j) return [...tiles];
  const next = [...tiles];
  const [moved] = next.splice(i, 1);
  next.splice(j, 0, moved!);
  return next;
}

/** Set (or toggle when `w` omitted) 1×1 ↔ 2×1. */
export function resizeTile(tiles: readonly ArrangeTile[], id: DeviceId, w?: 1 | 2): ArrangeTile[] {
  return tiles.map((t) => (t.id === id ? { ...t, w: w ?? (t.w === 2 ? 1 : 2) } : t));
}

/** New layout doc with the filter entry replaced; other filters kept. `rev`/`updatedAt` untouched (see `bumpLayout`). */
export function withFilter(
  layout: Layout | undefined,
  siteId: SiteId,
  filter: LayoutFilter,
  tiles: readonly ArrangeTile[],
  cols = 2,
): Layout {
  return {
    siteId,
    rev: layout?.rev ?? 0,
    updatedAt: layout?.updatedAt ?? 0,
    filters: { ...(layout?.filters ?? {}), [filter]: { cols, tiles: packTiles(tiles, cols) } },
  };
}

/** What is written: `rev + 1`, `updatedAt = now`. */
export function bumpLayout(layout: Layout, now = Date.now()): Layout {
  return { ...layout, rev: layout.rev + 1, updatedAt: now };
}
