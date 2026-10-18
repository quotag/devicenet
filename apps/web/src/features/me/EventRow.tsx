import { Badge } from "@/components/dn/Badge";
import { vi } from "@/i18n/vi";
import type { EventView } from "./history";

/** History row: time · title + kind caption · OK/Lỗi badge. `compact` = Me preview (single line unless error). */
export function EventRow({ ev, compact }: { ev: EventView; compact?: boolean }) {
  const showSub = !compact || ev.error;
  return (
    <div className="row" style={{ minHeight: 40 }} data-testid="event-row">
      <span className="cap dn-num" style={{ width: compact ? 56 : 44 }}>{ev.time}</span>
      <span className="row-main">
        <span className="lbl">{ev.title}</span>
        {showSub ? <span className="cap">{ev.sub}</span> : null}
      </span>
      <Badge tone={ev.error ? "error" : "ok"}>{ev.error ? vi.hist.error : vi.hist.ok}</Badge>
    </div>
  );
}
