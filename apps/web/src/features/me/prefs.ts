import { useSyncExternalStore } from "react";

export type TempUnit = "C" | "F";
const KEY = "dn.tempUnit";
const subs = new Set<() => void>();

export function getTempUnit(): TempUnit {
  try {
    return globalThis.localStorage?.getItem(KEY) === "F" ? "F" : "C";
  } catch {
    return "C";
  }
}

export function setTempUnitLocal(u: TempUnit): void {
  try {
    globalThis.localStorage?.setItem(KEY, u);
  } catch {
    /* ignore */
  }
  subs.forEach((f) => f());
}

export function useTempUnit(): TempUnit {
  return useSyncExternalStore(
    (f) => {
      subs.add(f);
      return () => subs.delete(f);
    },
    getTempUnit,
    () => "C" as TempUnit,
  );
}
