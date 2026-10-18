import { vi } from "@/i18n/vi";

/** "Thiết bị không phản hồi" explanation card (S20-Offline). */
export function OfflineCard() {
  return (
    <div className="card" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <span className="lbl">{vi.s20.unresponsive}</span>
      <p className="body-t" style={{ color: "var(--text-muted)" }}>
        {vi.s20.unresponsiveBody}
      </p>
    </div>
  );
}
