import type { ReactNode } from "react";
import { vi } from "@/i18n/vi";
import "./ds1.css";
import "./ds2.css";

export interface TileExtra {
  value: string | number;
  unit?: string;
}

export interface DeviceTileProps {
  size?: "1x1" | "2x1";
  kind?: "switch" | "sensor" | "mixed";
  name: string;
  /** Shown only when the room filter is "Tất cả". */
  room?: string | null;
  on?: boolean;
  pending?: boolean;
  offline?: boolean;
  arranging?: boolean;
  highlight?: boolean;
  value?: string | number | null;
  unit?: string;
  lastSeen?: string;
  extras?: TileExtra[];
  icon?: ReactNode;
  onToggle?: (next: boolean) => void;
  className?: string;
}

/** Presentational device tile (props only, no hooks). */
export function DeviceTile({
  size = "1x1",
  kind = "switch",
  name,
  room,
  on,
  pending,
  offline,
  arranging,
  highlight,
  value,
  unit,
  lastSeen,
  extras,
  icon,
  onToggle,
  className,
}: DeviceTileProps) {
  let mainValue: string;
  let mainUnit: string | undefined = unit;
  if (offline) {
    mainValue = vi.dn2.tileOffline;
    mainUnit = undefined;
  } else if (kind === "switch") {
    mainValue = on ? vi.dn2.tileOn : vi.dn2.tileOff;
    mainUnit = undefined;
  } else {
    mainValue = value == null ? "–" : String(value);
  }
  const tileOn = !offline && kind !== "sensor" && !!on;
  const sub = offline ? vi.dn2.lastSeen(lastSeen || "–") : room || null;
  const showToggle = kind !== "sensor" && !offline && !arranging;

  const cls = [
    "dn-tile",
    `dn-tile-${size}`,
    tileOn && "dn-tile-on",
    offline && "dn-tile-offline",
    arranging && "dn-tile-arranging",
    highlight && "dn-tile-highlight",
    className,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={cls} role="group" aria-label={name}>
      <div className="dn-tile-main">
        <div className="dn-tile-row1">
          <span className="dn-tile-icon" aria-hidden="true">
            {icon}
          </span>
          <span
            className={`dn-tile-dot ${offline ? "dn-tile-dot-off" : "dn-tile-dot-on"}`}
            title={offline ? vi.dn2.tileOffline : vi.dn2.tileOnline}
          />
        </div>
        <div className="dn-tile-value dn-num">
          {mainValue}
          {mainUnit ? <span className="dn-tile-unit"> {mainUnit}</span> : null}
        </div>
        <div className="dn-tile-name">{name}</div>
        {sub ? <div className="dn-tile-room">{sub}</div> : null}
      </div>
      {size === "2x1" ? (
        <div className="dn-tile-side">
          {(extras ?? []).slice(0, 2).map((x, i) => (
            <div key={i} className="dn-tile-extra dn-num">
              {String(x.value)}
              {x.unit ? <span className="dn-tile-unit"> {x.unit}</span> : null}
            </div>
          ))}
        </div>
      ) : null}
      {showToggle ? (
        <div className="dn-tile-toggle">
          <button
            type="button"
            role="switch"
            aria-checked={!!on}
            aria-busy={pending ? true : undefined}
            aria-label={on ? vi.dn2.turnOff(name) : vi.dn2.turnOn(name)}
            className={["dn-switch", pending && "dn-switch-pending"].filter(Boolean).join(" ")}
            disabled={pending}
            onClick={() => onToggle?.(!on)}
          >
            <span className="dn-switch-knob">{pending ? <span className="dn-spin" aria-hidden="true" /> : null}</span>
          </button>
        </div>
      ) : null}
      {arranging ? <span className="dn-tile-handle" aria-hidden="true" /> : null}
    </div>
  );
}
