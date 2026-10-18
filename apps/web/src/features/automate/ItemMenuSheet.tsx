import { useState } from "react";
import { ChevronRight } from "lucide-react";
import { useStore } from "zustand";
import { referencedIds } from "@devicenet/shared";
import { Sheet } from "@/components/dn/Sheet";
import { ConfirmDialog, WillBreakList } from "@/features/me/sheets/ConfirmDialog";
import { sheetsVi } from "@/i18n/sheets";
import { configStore, toastStore, uiStore } from "@/stores";
import { useConfigWrites } from "@/transport/hooks";
import { openEditor } from "./editorTarget";

const rowStyle = {
  border: 0,
  background: "transparent",
  color: "var(--text)",
  padding: "8px 0",
  cursor: "pointer",
  textAlign: "left",
  width: "100%",
} as const;

/** Rules whose actions run `sceneId` via `runScene` (they break when the scene is deleted). */
export function rulesUsingScene(sceneId: string, rules: Record<string, Parameters<typeof referencedIds>[0] & { name: string }>): string[] {
  return Object.values(rules)
    .filter((r) => referencedIds(r).scenes.has(sceneId))
    .map((r) => r.name);
}

export interface ItemMenuSheetProps {
  type: "scene" | "rule";
  id: string;
  /** Desktop editor opens straight at the confirm dialog. */
  initialStep?: "menu" | "confirm";
}

/** SH-6: long-press menu (Sửa / Xóa) → confirm → delete the scene / rule doc. */
export function ItemMenuSheet({ type, id, initialStep = "menu" }: ItemMenuSheetProps) {
  const s = sheetsVi.sh6;
  const writes = useConfigWrites();
  const item = useStore(configStore, (st) => (type === "scene" ? st.scenes[id] : st.rules[id]));
  const rules = useStore(configStore, (st) => st.rules);
  const [step, setStep] = useState<"menu" | "confirm">(initialStep);
  const [busy, setBusy] = useState(false);
  const close = () => uiStore.getState().closeSheet();
  if (!item) return null;
  const broken = type === "scene" ? rulesUsingScene(id, rules as never) : [];

  async function remove() {
    if (!writes || busy) return;
    setBusy(true);
    try {
      await (type === "scene" ? writes.deleteScene(id) : writes.deleteRule(id));
      close();
    } catch {
      toastStore.getState().show({ kind: "error", text: s.error });
      setBusy(false);
    }
  }

  if (step === "confirm") {
    return (
      <ConfirmDialog
        title={s.confirmTitle(item.name)}
        cancelLabel={s.keep}
        confirmLabel={s.delete}
        busy={busy}
        onCancel={close}
        onConfirm={() => void remove()}
      >
        <p className="cap" style={{ margin: 0 }}>
          {type === "rule" ? s.ruleBody : broken.length > 0 ? s.sceneBody(broken.length) : s.sceneBodyNone}
        </p>
        <WillBreakList label={s.willBreak} names={broken} />
        <p className="cap" style={{ margin: 0 }}>
          {s.history}
        </p>
      </ConfirmDialog>
    );
  }

  return (
    <Sheet open title={item.name} onOpenChange={(o) => !o && close()}>
      <div style={{ display: "flex", flexDirection: "column" }}>
        <button
          type="button"
          className="row"
          style={rowStyle}
          onClick={() => {
            close();
            openEditor({ kind: "edit", mode: type === "scene" ? "scene" : "rule", id });
          }}
        >
          <span className="row-main">
            <span className="lbl">{s.edit}</span>
            <span className="cap">{s.editCap}</span>
          </span>
          <ChevronRight className="ic" aria-hidden="true" style={{ color: "var(--text-muted)" }} />
        </button>
        <button type="button" className="row" style={{ ...rowStyle, color: "var(--danger, var(--text))" }} disabled={!writes} onClick={() => setStep("confirm")}>
          <span className="row-main">
            <span className="lbl">{s.delete}</span>
          </span>
        </button>
      </div>
    </Sheet>
  );
}
