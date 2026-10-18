import type { Device, Scene, SummaryContext } from "@devicenet/shared";

/** Build the `SummaryContext` used by `summarizeTrigger/summarizeAction` from the config store maps. */
export function makeSummaryContext(devices: Record<string, Device>, scenes: Record<string, Scene>): SummaryContext {
  return {
    deviceName: (id) => devices[id]?.name ?? id,
    propertyLabel: (id, key) => devices[id]?.properties[key]?.label ?? key,
    unit: (id, key) => {
      const p = devices[id]?.properties[key];
      return p && p.type === "numeric" ? p.unit : undefined;
    },
    sceneName: (id) => scenes[id]?.name ?? id,
  };
}

/** "07:02" today, "18:05 hôm qua" yesterday, else "dd/MM HH:mm" (site timezone). */
export function lastRunLabel(ts: number, tz: string, now = Date.now()): string {
  const day = (t: number) => new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(t);
  const time = new Intl.DateTimeFormat("vi-VN", { timeZone: tz, hour: "2-digit", minute: "2-digit", hour12: false }).format(ts);
  if (day(ts) === day(now)) return time;
  if (day(ts) === day(now - 86_400_000)) return `${time} hôm qua`;
  const dm = new Intl.DateTimeFormat("vi-VN", { timeZone: tz, day: "2-digit", month: "2-digit" }).format(ts);
  return `${dm} ${time}`;
}
