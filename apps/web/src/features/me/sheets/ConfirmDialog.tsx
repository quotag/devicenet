import type { ReactNode } from "react";
import { Button } from "@/components/dn/Button";
import { Sheet } from "@/components/dn/Sheet";

export interface ConfirmDialogProps {
  title: string;
  /** Body (paragraphs, reference list, checkbox). */
  children?: ReactNode;
  cancelLabel: string;
  confirmLabel: string;
  confirmVariant?: "danger" | "primary";
  confirmDisabled?: boolean;
  busy?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}

/** Centred confirm dialog shared by SH-4 / SH-5 confirm / SH-6 confirm (secondary "keep" + danger/primary action). */
export function ConfirmDialog({
  title,
  children,
  cancelLabel,
  confirmLabel,
  confirmVariant = "danger",
  confirmDisabled,
  busy,
  onCancel,
  onConfirm,
}: ConfirmDialogProps) {
  return (
    <Sheet open asDialog title={title} onOpenChange={(o) => !o && onCancel()}>
      <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-3)" }}>
        {children}
        <div style={{ display: "flex", gap: "var(--space-2)" }}>
          <Button type="button" variant="secondary" style={{ flex: 1 }} onClick={onCancel}>
            {cancelLabel}
          </Button>
          <Button type="button" variant={confirmVariant} style={{ flex: 1 }} loading={busy} disabled={confirmDisabled} onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </div>
      </div>
    </Sheet>
  );
}

/** "Sẽ lỗi" list used by SH-4 and SH-6. */
export function WillBreakList({ label, names }: { label: string; names: string[] }) {
  if (names.length === 0) return null;
  return (
    <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
      {names.map((n) => (
        <li key={n} style={{ display: "flex", alignItems: "center", gap: "var(--space-2)" }}>
          <span className="dn-badge dn-badge-error">{label}</span>
          <span className="lbl">{n}</span>
        </li>
      ))}
    </ul>
  );
}
