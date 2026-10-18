import { Clock, Lightbulb, Moon, Plug, Plus, Sunset, Zap, type LucideIcon } from "lucide-react";
import type { Suggestion } from "./suggestions";

const ICONS: Record<Suggestion["icon"], LucideIcon> = {
  plug: Plug,
  lightbulb: Lightbulb,
  moon: Moon,
  clock: Clock,
  zap: Zap,
  sunset: Sunset,
};

export function SuggestionCard({ s, onPick }: { s: Suggestion; onPick: (s: Suggestion) => void }) {
  const Icon = ICONS[s.icon];
  return (
    <button
      type="button"
      className="card"
      onClick={() => onPick(s)}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        textAlign: "left",
        color: "var(--text)",
        cursor: "pointer",
        fontFamily: "inherit",
        borderStyle: "dashed",
      }}
    >
      <span style={{ color: "var(--accent)", display: "inline-flex" }}>
        <Icon className="ic" aria-hidden="true" />
      </span>
      <span className="row-main">
        <span className="lbl">{s.title}</span>
        <span className="cap">{s.sub}</span>
      </span>
      <Plus className="ic" aria-hidden="true" style={{ color: "var(--text-muted)" }} />
    </button>
  );
}
