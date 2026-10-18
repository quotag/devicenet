import "./device.css";
import { Suspense, lazy, useState } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import type { DeviceId, HubId, Property, PropertyValue } from "@devicenet/shared";
import { Row } from "@/components/dn/Row";
import { vi } from "@/i18n/vi";
import { formatValue, relativeTime } from "@/lib/format";
import { useHistory } from "@/transport/hooks";

export const STALE_MS = 10 * 60 * 1000;

const PropertyChart = lazy(() => import("./PropertyChart"));

export interface PropertyRowProps {
  prop: Property;
  value: PropertyValue | undefined;
  /** Epoch ms of last update (`at[key]`). */
  at: number | undefined;
  now: number;
  /** Offline: value shown as "—". */
  offline?: boolean;
  /** Overrides the relative age text (offline: clock time). */
  atLabel?: string;
  onClick?: () => void;
  /** Present on numeric sensor rows → tapping toggles the 24 h chart. */
  history?: { hubId: HubId; deviceId: DeviceId; tz: string };
}

function ChartPanel({ prop, history }: { prop: Property; history: NonNullable<PropertyRowProps["history"]> }) {
  const t = vi.s20;
  const h = useHistory(history.hubId, history.deviceId, prop.key);
  let body;
  if (h.status === "loading") body = <p className="cap" style={{ margin: 0 }}>{t.chartLoading}</p>;
  else if (h.status === "error") body = <p className="cap" style={{ margin: 0 }}>{t.chartError}</p>;
  else if (h.points.length === 0) body = <p className="cap" style={{ margin: 0 }} data-testid="chart-empty">{t.chartEmpty}</p>;
  else
    body = (
      <Suspense fallback={<p className="cap" style={{ margin: 0 }}>{t.chartLoading}</p>}>
        <PropertyChart points={h.points} from={h.from} to={h.to} tz={history.tz} />
      </Suspense>
    );
  return (
    <div
      role="img"
      aria-label={t.chartLabel(prop.label)}
      style={{ padding: "0 12px 12px", display: "flex", flexDirection: "column", gap: 4 }}
      data-testid="property-chart"
    >
      {body}
    </div>
  );
}

/** Sensor / config read-out: label, "cập nhật x trước", value + unit; stale (> 10 min) is muted. */
export function PropertyRow({ prop, value, at, now, offline, atLabel, onClick, history }: PropertyRowProps) {
  const [open, setOpen] = useState(false);
  const stale = at !== undefined && now - at > STALE_MS;
  const shown = offline || value === undefined ? vi.s20.noValue : formatValue(prop, value);
  const hint = at === undefined ? undefined : vi.s20.updated(atLabel ?? relativeTime(at, now));
  const chartable = history !== undefined && prop.type === "numeric" && !onClick;
  const Chev = open ? ChevronUp : ChevronDown;
  return (
    <>
      <Row
        label={prop.label}
        hint={hint}
        trailing={
          <span className="lbl dn-num" style={{ fontSize: 17 }}>
            {shown}
            {chartable ? <Chev className="ic" aria-hidden="true" style={{ color: "var(--text-muted)", marginLeft: 8, verticalAlign: "middle" }} /> : null}
          </span>
        }
        chevron={chartable ? false : undefined}
        onClick={chartable ? () => setOpen((o) => !o) : onClick}
        className={stale ? "dn-row-stale" : undefined}
      />
      {chartable && open ? <ChartPanel prop={prop} history={history} /> : null}
    </>
  );
}
