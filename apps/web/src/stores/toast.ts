import { createStore } from "zustand/vanilla";

export interface ToastData {
  kind: "timeout" | "error" | "update";
  text: string;
  action?: { label: string; run: () => void };
}
export interface ToastState {
  current: ToastData | null;
  show(t: ToastData): void;
  dismiss(): void;
  reset(): void;
}

/** One toast at a time (FR-F14): a new one replaces the current. */
export const toastStore = createStore<ToastState>((set) => ({
  current: null,
  show: (current) => set({ current }),
  dismiss: () => set({ current: null }),
  reset: () => set({ current: null }),
}));
