import { ChevronRight, Play, Zap } from "lucide-react";
import { Sheet } from "@/components/dn/Sheet";
import { vi } from "@/i18n/vi";
import { uiStore } from "@/stores";
import { openEditor, type EditorTarget } from "./editorTarget";

function Item({ icon, label, cap, onClick }: { icon: React.ReactNode; label: string; cap: string; onClick: () => void }) {
  return (
    <button
      type="button"
      className="row"
      onClick={onClick}
      style={{ border: 0, background: "transparent", color: "var(--text)", padding: "8px 0", cursor: "pointer", textAlign: "left", width: "100%" }}
    >
      {icon}
      <span className="row-main">
        <span className="lbl">{label}</span>
        <span className="cap">{cap}</span>
      </span>
      <ChevronRight className="ic" aria-hidden="true" style={{ color: "var(--text-muted)" }} />
    </button>
  );
}

/** SH-2, Automate variant: Tạo scene / Tạo automation. */
export function AutomateMenuSheet({ open = (t: EditorTarget) => openEditor(t) }: { open?: (t: EditorTarget) => void }) {
  const close = () => uiStore.getState().closeSheet();
  const a = vi.automate;
  return (
    <Sheet open onOpenChange={(o) => !o && close()} title={vi.sh2.title}>
      <div style={{ display: "flex", flexDirection: "column" }}>
        <Item
          icon={<Play className="ic" aria-hidden="true" />}
          label={a.menuNewScene}
          cap={a.menuNewSceneCap}
          onClick={() => {
            close();
            open({ kind: "new", mode: "scene" });
          }}
        />
        <Item
          icon={<Zap className="ic" aria-hidden="true" />}
          label={a.menuNewRule}
          cap={a.menuNewRuleCap}
          onClick={() => {
            close();
            open({ kind: "new", mode: "rule" });
          }}
        />
      </div>
    </Sheet>
  );
}
