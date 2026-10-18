import { createStore } from "zustand/vanilla";
import type { DeviceId, RoomId, SiteId } from "@devicenet/shared";

export type Theme = "light" | "dark" | "system";
export type Sheet =
  | { kind: "sh2"; ctx: "home" | "automate" }
  | { kind: "sh5"; mode: string; [k: string]: unknown }
  | { kind: string; [k: string]: unknown };

const SITE_KEY = "dn.siteId";

function readSite(): SiteId | null {
  try {
    return (globalThis.localStorage?.getItem(SITE_KEY) as SiteId | null) ?? null;
  } catch {
    return null;
  }
}
function writeSite(id: SiteId | null) {
  try {
    if (id) globalThis.localStorage?.setItem(SITE_KEY, id);
    else globalThis.localStorage?.removeItem(SITE_KEY);
  } catch {
    /* ignore */
  }
}

export interface UiState {
  siteId: SiteId | null;
  filter: "all" | RoomId;
  arranging: boolean;
  sheet: Sheet | null;
  highlight: { deviceId: DeviceId; until: number } | null;
  theme: Theme;
  setSiteId(id: SiteId | null): void;
  setFilter(f: "all" | RoomId): void;
  setArranging(v: boolean): void;
  openSheet(s: Sheet): void;
  closeSheet(): void;
  setHighlight(h: { deviceId: DeviceId; until: number } | null): void;
  setTheme(t: Theme): void;
  reset(): void;
}

export const uiStore = createStore<UiState>((set) => ({
  siteId: readSite(),
  filter: "all",
  arranging: false,
  sheet: null,
  highlight: null,
  theme: "system",
  setSiteId: (siteId) => {
    writeSite(siteId);
    set({ siteId, filter: "all" });
  },
  setFilter: (filter) => set({ filter }),
  setArranging: (arranging) => set({ arranging }),
  openSheet: (sheet) => set({ sheet }),
  closeSheet: () => set({ sheet: null }),
  setHighlight: (highlight) => set({ highlight }),
  setTheme: (theme) => set({ theme }),
  // siteId and theme are persisted preferences; keep them on sign-out reset.
  reset: () => set({ filter: "all", arranging: false, sheet: null, highlight: null }),
}));
