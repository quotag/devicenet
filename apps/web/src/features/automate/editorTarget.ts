import type { Action, Trigger } from "@devicenet/shared";

/** A pre-filled draft produced from a suggestion template (consumed by the S-30 editor, B18/B19). */
export interface SuggestionDraft {
  mode: "scene" | "rule";
  name: string;
  trigger?: Trigger;
  actions: Action[];
}

export type EditorTarget =
  | { kind: "new"; mode: "scene" | "rule" }
  | { kind: "edit"; mode: "scene" | "rule"; id: string }
  | { kind: "suggestion"; draft: SuggestionDraft };

type Opener = (t: EditorTarget) => void;
let opener: Opener = (t) => console.debug("[automate] S-30 not wired yet", t);

/** B19 registers the real S-30 navigation here; until then opening the editor is a no-op. */
export function setEditorOpener(fn: Opener): void {
  opener = fn;
}
export function openEditor(t: EditorTarget): void {
  opener(t);
}

/** SH-6 (edit/delete menu) hook point, owned by B21: it reads `ui.sheet = { kind: "sh6", type, id }`. */
export function sh6Sheet(type: "scene" | "rule", id: string) {
  return { kind: "sh6", type, id } as const;
}
