import type { EditorTarget } from "../editorTarget";

/** Target handed from S-02 (via `setEditorOpener`) to the lazy S-30 route; lost on reload (route then returns to S-02). */
let current: EditorTarget | null = null;
export const setCurrentTarget = (t: EditorTarget | null) => void (current = t);
export const getCurrentTarget = () => current;
