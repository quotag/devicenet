import type { Layout, SiteId } from "@devicenet/shared";
import { configStore } from "@/stores";
import { bumpLayout, withFilter, type ArrangeTile, type LayoutFilter } from "./layoutModel";

export const SAVE_DEBOUNCE_MS = 500;

export interface LayoutSaver {
  /** Apply locally now (optimistic) and schedule a debounced write. */
  update(siteId: SiteId, filter: LayoutFilter, tiles: readonly ArrangeTile[], cols?: number): void;
  /** Write pending changes immediately (e.g. "Xong"). */
  flush(): Promise<void>;
  cancel(): void;
}

/**
 * Debounced layout writer (FR-F01 arrange, D-02): every change updates `configStore.layouts` at once,
 * the doc is written once per quiet period of `delay` ms with `rev + 1` and `updatedAt`.
 */
export function createLayoutSaver(
  save: (layout: Layout) => Promise<void>,
  { delay = SAVE_DEBOUNCE_MS, now = Date.now }: { delay?: number; now?: () => number } = {},
): LayoutSaver {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const dirty = new Set<SiteId>();

  const write = async () => {
    timer = null;
    const sites = [...dirty];
    dirty.clear();
    await Promise.all(
      sites.map(async (siteId) => {
        const cur = configStore.getState().layouts[siteId];
        if (!cur) return;
        const next = bumpLayout(cur, now());
        const st = configStore.getState();
        st.setLayouts({ ...st.layouts, [siteId]: next });
        try {
          await save(next);
        } catch {
          /* keep local order; next change or snapshot reconciles */
        }
      }),
    );
  };

  return {
    update(siteId, filter, tiles, cols = 2) {
      const st = configStore.getState();
      st.setLayouts({ ...st.layouts, [siteId]: withFilter(st.layouts[siteId], siteId, filter, tiles, cols) });
      dirty.add(siteId);
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => void write(), delay);
    },
    async flush() {
      if (timer) clearTimeout(timer);
      if (dirty.size) await write();
      timer = null;
    },
    cancel() {
      if (timer) clearTimeout(timer);
      timer = null;
      dirty.clear();
    },
  };
}
