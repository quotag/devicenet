import { useSyncExternalStore } from "react";

export const DESKTOP_QUERY = "(min-width: 900px)";

function query(): MediaQueryList | null {
  return typeof window !== "undefined" && typeof window.matchMedia === "function" ? window.matchMedia(DESKTOP_QUERY) : null;
}

function subscribe(cb: () => void): () => void {
  const m = query();
  if (!m) return () => undefined;
  m.addEventListener?.("change", cb);
  return () => m.removeEventListener?.("change", cb);
}

/** True at viewport >= 900 px (FR-F11). False when `matchMedia` is unavailable (jsdom default). */
export function useIsDesktop(): boolean {
  return useSyncExternalStore(subscribe, () => query()?.matches ?? false, () => false);
}
