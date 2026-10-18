import { Button } from "@/components/dn/Button";
import { Skeleton } from "@/components/dn/Skeleton";
import { vi } from "@/i18n/vi";

export function HomeSkeleton() {
  return (
    <>
      <div style={{ display: "flex", gap: 8, padding: "12px 16px 4px" }}>
        {[72, 56, 96].map((w) => (
          <Skeleton key={w} width={w} height={36} />
        ))}
      </div>
      <div
        aria-label={vi.common.loading}
        data-testid="home-skeleton"
        style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 16, padding: "12px 16px 16px" }}
      >
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} height={120} />
        ))}
      </div>
    </>
  );
}

const wrap = {
  flex: 1,
  display: "flex",
  flexDirection: "column" as const,
  alignItems: "center",
  justifyContent: "center",
  gap: 16,
  padding: "48px 32px",
  textAlign: "center" as const,
};
const title = { fontSize: 20, lineHeight: "26px", fontWeight: 600 };
const body = { color: "var(--text-muted)", margin: 0 };

export function NoDevices({ onAdd }: { onAdd: () => void }) {
  return (
    <div style={wrap} data-testid="home-empty">
      <div
        aria-hidden="true"
        style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 8, width: 120 }}
      >
        {[0, 1, 2].map((i) => (
          <div key={i} style={{ height: 40, borderRadius: 10, border: "2px dashed var(--border)" }} />
        ))}
        <div style={{ height: 40, borderRadius: 10, background: "var(--on-tint)", border: "2px solid var(--accent)" }} />
      </div>
      <span style={title}>{vi.home.emptyTitle}</span>
      <p style={body}>{vi.home.emptyBody}</p>
      <Button variant="primary" onClick={onAdd}>
        {vi.home.emptyCta}
      </Button>
    </div>
  );
}

export function RoomEmpty({ room, onAssign }: { room: string; onAssign: () => void }) {
  return (
    <div style={wrap} data-testid="home-room-empty">
      <span style={title}>{vi.home.roomEmptyTitle(room)}</span>
      <p style={body}>{vi.home.roomEmptyBody}</p>
      <Button variant="secondary" onClick={onAssign}>
        {vi.home.roomEmptyCta(room)}
      </Button>
    </div>
  );
}
