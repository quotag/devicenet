import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { ArrowLeft, Clock } from "lucide-react";
import { useStore } from "zustand";
import { Chip } from "@/components/dn/Chip";
import { vi } from "@/i18n/vi";
import { configStore } from "@/stores";
import { EventRow } from "./EventRow";
import { groupByDay } from "./history";

/** S-03 Lich su 7 ngay: chips Tat ca / Chi loi, grouped by day, empty state. */
export function HistoryScreen({ now = Date.now }: { now?: () => number }) {
  const h = vi.hist;
  const navigate = useNavigate();
  const events = useStore(configStore, (s) => s.events);
  const rules = useStore(configStore, (s) => s.rules);
  const scenes = useStore(configStore, (s) => s.scenes);
  const devices = useStore(configStore, (s) => s.devices);
  const [onlyErrors, setOnlyErrors] = useState(false);
  const groups = groupByDay(events, now(), onlyErrors, { rules, scenes, devices });

  return (
    <>
      <header className="hdr">
        <div className="hdr-l">
          <button className="ibtn" type="button" aria-label={vi.me.back} onClick={() => void navigate({ to: "/me" })}>
            <ArrowLeft className="ic" aria-hidden="true" />
          </button>
          <h1 className="title" style={{ fontSize: 17 }}>{h.title}</h1>
        </div>
        <div className="hdr-r" />
      </header>
      <div className="body" style={{ overflowY: "auto" }}>
        <div style={{ display: "flex", gap: 8, padding: "12px 16px 0" }}>
          <Chip selected={!onlyErrors} onClick={() => setOnlyErrors(false)}>{h.all}</Chip>
          <Chip selected={onlyErrors} onClick={() => setOnlyErrors(true)}>{h.errorsOnly}</Chip>
        </div>
        {groups.length ? (
          <>
            {groups.map((g) => (
              <section key={g.key}>
                <p className="sect-h">{g.label}</p>
                <div className="list">
                  {g.items.map((ev) => (
                    <EventRow key={ev.id} ev={ev} />
                  ))}
                </div>
              </section>
            ))}
            <p className="cap" style={{ textAlign: "center", padding: 16 }}>{h.footer}</p>
          </>
        ) : (
          <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 8, padding: 32, textAlign: "center" }}>
            <Clock className="ic ic-lg" aria-hidden="true" style={{ color: "var(--text-muted)" }} />
            <span className="lbl">{h.emptyTitle}</span>
            <p className="cap">{h.emptyBody}</p>
          </div>
        )}
      </div>
    </>
  );
}
