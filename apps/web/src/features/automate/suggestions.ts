import type { Action, Device } from "@devicenet/shared";
import { toggleKey } from "@/lib/deviceView";
import type { SuggestionDraft } from "./editorTarget";

export interface Suggestion {
  key: string;
  icon: "plug" | "lightbulb" | "moon" | "clock" | "zap" | "sunset";
  title: string;
  sub: string;
  draft: SuggestionDraft;
}

const setTo = (d: Device, value: boolean): Action => ({
  type: "setProperty",
  deviceId: d.id,
  property: toggleKey(d)!,
  value,
});
const isPlug = (d: Device) => d.icon === "plug";
const isLight = (d: Device) => d.icon === "lightbulb";
const isFan = (d: Device) => d.icon === "fan";
const pick = <T>(a: T[], pref?: (x: T) => boolean): T | undefined => (pref ? a.find(pref) : undefined) ?? a[0];

/** Templates generated from the user's own devices (spec FR-F02). At most 3 per kind; only those that apply. */
export function buildSuggestions(devicesIn: Device[], kind: "scene" | "rule"): Suggestion[] {
  const devices = devicesIn.filter((d) => d.status === "active" && toggleKey(d) !== undefined);
  const plugs = devices.filter(isPlug);
  const lights = devices.filter(isLight);
  const fans = devices.filter(isFan);
  const out: Suggestion[] = [];
  const yard = pick(lights, (d) => /sân/i.test(d.name));

  if (kind === "scene") {
    if (plugs.length) {
      out.push({
        key: "all-plugs-off",
        icon: "plug",
        title: "Tắt hết ổ cắm",
        sub: `${plugs.length} hành động · ${plugs.map((d) => d.name).join(", ")}`,
        draft: { mode: "scene", name: "Tắt hết ổ cắm", actions: plugs.slice(0, 20).map((d) => setTo(d, false)) },
      });
    }
    if (yard) {
      out.push({
        key: "yard-light-on",
        icon: "lightbulb",
        title: "Bật đèn sân",
        sub: `1 hành động · ${yard.name}`,
        draft: { mode: "scene", name: "Bật đèn sân", actions: [setTo(yard, true)] },
      });
    }
    const bedLight = pick(lights.filter((d) => d !== yard));
    const fan = pick(fans);
    if (bedLight || fan) {
      const actions: Action[] = [];
      const parts: string[] = [];
      if (bedLight) {
        actions.push(setTo(bedLight, false));
        parts.push(`tắt ${bedLight.name.toLowerCase()}`);
      }
      if (fan) {
        actions.push({ type: "delay", seconds: 1800 }, setTo(fan, false));
        parts.push(`tắt ${fan.name.toLowerCase()} sau 30 phút`);
      }
      out.push({
        key: "bedtime",
        icon: "moon",
        title: "Đi ngủ",
        sub: `${actions.length} hành động · ${parts.join(", ")}`,
        draft: { mode: "scene", name: "Đi ngủ", actions },
      });
    }
  } else {
    const washer = pick(plugs, (d) => /giặt/i.test(d.name));
    if (washer) {
      const name = `Tắt ${washer.name.toLowerCase()} lúc 23:00`;
      out.push({
        key: "washer-off-23",
        icon: "clock",
        title: name,
        sub: "Thời gian → Đặt thiết bị",
        draft: { mode: "rule", name, trigger: { type: "schedule", at: "23:00" }, actions: [setTo(washer, false)] },
      });
    }
    const meter = devicesIn.find((d) => d.status === "active" && d.properties.power?.type === "numeric");
    if (meter) {
      out.push({
        key: "power-over-1500",
        icon: "zap",
        title: "Báo khi công suất > 1500 W",
        sub: "Thiết bị → Thông báo",
        draft: {
          mode: "rule",
          name: "Báo khi công suất > 1500 W",
          trigger: { type: "property", deviceId: meter.id, property: "power", op: "gt", value: 1500 },
          actions: [{ type: "notify", title: `${meter.name} dùng hơn 1500 W`, level: "warning" }],
        },
      });
    }
    if (yard) {
      out.push({
        key: "yard-on-sunset",
        icon: "sunset",
        title: "Bật đèn sân khi mặt trời lặn",
        sub: "Mặt trời → Đặt thiết bị",
        draft: {
          mode: "rule",
          name: "Bật đèn sân khi mặt trời lặn",
          trigger: { type: "sun", event: "sunset", offsetMin: 0 },
          actions: [setTo(yard, true)],
        },
      });
    }
  }
  return out.slice(0, 3);
}
