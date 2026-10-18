import type { Device } from "@devicenet/shared";
import { vi } from "@/i18n/vi";

export interface TechGroupProps {
  device: Device;
  hubName?: string;
  lqi?: number;
  offline?: boolean;
}

/** "Kỹ thuật" key/value list. */
export function TechGroup({ device, hubName, lqi, offline }: TechGroupProps) {
  const t = vi.s20;
  const lqiText = offline ? t.lqiOffline(lqi) : lqi === undefined ? "—" : t.lqi(lqi);
  const rows: [string, string, boolean][] = [
    [t.driver, `${device.driver}${device.model ? ` · ${device.model}` : ""}`, true],
    [t.address, device.externalId, true],
    [t.vendorModel, [device.vendor, device.model].filter(Boolean).join(" · ") || "—", false],
    [t.firmware, device.firmware ?? "—", true],
    [t.lqiLabel, lqiText, true],
    [t.hub, hubName ?? "—", false],
  ];
  return (
    <div className="list" style={{ margin: 0 }}>
      {rows.map(([k, v, num]) => (
        <div className="kv" key={k}>
          <span className="cap">{k}</span>
          <span className={num ? "lbl dn-num" : "lbl"}>{v}</span>
        </div>
      ))}
    </div>
  );
}
