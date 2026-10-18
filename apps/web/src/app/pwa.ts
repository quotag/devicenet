import { vi } from "@/i18n/vi";
import { toastStore } from "@/stores/toast";

/** Registers the service worker (autoUpdate); when a new version is installed, shows "Có bản mới" + "Tải lại" (S-01 Toast `update`). */
export function registerPwa(): void {
  if (!import.meta.env.PROD || typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
  void import("virtual:pwa-register").then(({ registerSW }) => {
    const updateSW = registerSW({
      immediate: true,
      onRegisteredSW(_url, reg) {
        reg?.addEventListener("updatefound", () => {
          const w = reg.installing;
          w?.addEventListener("statechange", () => {
            if (w.state === "installed" && navigator.serviceWorker.controller) announceUpdate(() => void updateSW(true));
          });
        });
      },
    });
  });
}

export function announceUpdate(reload: () => void): void {
  toastStore.getState().show({
    kind: "update",
    text: vi.toast.updateAvailable,
    action: { label: vi.toast.updateAction, run: reload },
  });
}
