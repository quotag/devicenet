import { ChevronRight, Plus } from "lucide-react";
import type { ReactNode } from "react";
import { Card } from "@/components/dn/Card";
import { vi } from "@/i18n/vi";

const t = vi.s30;

/** Tappable summary row used in Khi / Và nếu / Thì (artboard S30-RuleEditor). */
export function BlockRow({ label, caption, onClick, lead, invalid, "aria-label": aria }: {
  label: string;
  caption?: string;
  onClick?: () => void;
  lead?: ReactNode;
  invalid?: boolean;
  "aria-label"?: string;
}) {
  return (
    <div className="row" style={{ padding: "8px 0", minHeight: 44, gap: 8 }}>
      {lead}
      <button
        type="button"
        className="row-main"
        aria-label={aria}
        onClick={onClick}
        style={{ background: "none", border: 0, padding: 0, textAlign: "left", color: invalid ? "var(--warning)" : "inherit", font: "inherit", cursor: "pointer", display: "flex", flexDirection: "column", flex: 1, minWidth: 0 }}
      >
        <span className="lbl">{label}</span>
        {caption ? <span className="cap">{caption}</span> : null}
      </button>
      <ChevronRight className="ic" aria-hidden="true" style={{ color: "var(--text-muted)" }} />
    </div>
  );
}

export interface RuleBlockProps {
  title: string;
  /** Hide the "+" (e.g. Khi when a trigger is already chosen). */
  onAdd?: () => void;
  addLabel?: string;
  /** Warning border + message (FR-F08 "Invalid"). */
  error?: string;
  children?: ReactNode;
}

export function RuleBlock({ title, onAdd, addLabel, error, children }: RuleBlockProps) {
  return (
    <Card
      title={title}
      state={error ? "invalid" : "default"}
      error={error}
      action={
        onAdd ? (
          <button type="button" className="ibtn" aria-label={addLabel ?? `${t.add} ${title}`} onClick={onAdd}>
            <Plus className="ic" aria-hidden="true" />
          </button>
        ) : undefined
      }
    >
      {children}
    </Card>
  );
}
