import { sessionStore } from "./session";
import { connectionStore } from "./connection";
import { deviceStateStore } from "./deviceState";
import { configStore } from "./config";
import { uiStore } from "./ui";
import { toastStore } from "./toast";

export * from "./session";
export * from "./connection";
export * from "./deviceState";
export * from "./config";
export * from "./ui";
export * from "./toast";

/** Sign-out: reset every store (session ends in `signedOut`). */
export function resetAll(): void {
  connectionStore.getState().reset();
  deviceStateStore.getState().reset();
  configStore.getState().reset();
  uiStore.getState().reset();
  toastStore.getState().reset();
  sessionStore.getState().reset();
}
