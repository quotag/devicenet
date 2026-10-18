/**
 * S-30 Save (FR-F08 / US-10): validate → Firestore write (`rev+1`, `updatedAt`, `hubId` = site hub)
 * → wait for the hub to report `appliedRev === rev` (≤ 5 s) else "syncing" (not an error).
 */
import type { Rule, Scene } from "@devicenet/shared";
import { configStore } from "@/stores/config";
import { saveRule, saveScene } from "@/transport/writes";
import type { EditorDraft } from "./state";
import { validate, type EditorIssue } from "./validate";

export type ApplyStatus = "applied" | "syncing";

export const APPLY_TIMEOUT_MS = 5000;

/** Resolves "applied" once the stored doc's `appliedRev` reaches `rev`, "syncing" after `timeoutMs`. */
export function awaitApplied(
  kind: "rule" | "scene",
  id: string,
  rev: number,
  timeoutMs = APPLY_TIMEOUT_MS,
  store = configStore,
): Promise<ApplyStatus> {
  const applied = () => {
    const s = store.getState();
    const d = kind === "rule" ? s.rules[id] : s.scenes[id];
    return d?.appliedRev !== undefined && d.appliedRev >= rev;
  };
  if (applied()) return Promise.resolve("applied");
  return new Promise((resolve) => {
    const done = (st: ApplyStatus) => {
      clearTimeout(timer);
      unsub();
      resolve(st);
    };
    const unsub = store.subscribe(() => {
      if (applied()) done("applied");
    });
    const timer = setTimeout(() => done("syncing"), timeoutMs);
  });
}

export interface SaveContext {
  tenantId: string;
  siteId: string | undefined;
  hubId: string | undefined;
  now?: number;
  timeoutMs?: number;
}

export interface SaveDeps {
  saveRule: (tenantId: string, rule: Rule, isNew: boolean) => Promise<void>;
  saveScene: (tenantId: string, scene: Scene, isNew: boolean) => Promise<void>;
  awaitApplied: typeof awaitApplied;
}

const defaultDeps: SaveDeps = { saveRule, saveScene, awaitApplied };

export type SaveResult =
  | { ok: true; kind: "rule" | "scene"; id: string; rev: number; status: ApplyStatus }
  | { ok: false; issues: EditorIssue[] };

/** Write errors (Firestore/network) reject; the caller shows a toast. */
export async function saveDraft(draft: EditorDraft, ctx: SaveContext, deps: SaveDeps = defaultDeps): Promise<SaveResult> {
  const rev = draft.rev + 1;
  const v = validate(draft, { siteId: ctx.siteId, hubId: ctx.hubId, rev, updatedAt: ctx.now ?? Date.now() });
  if (!v.ok) return { ok: false, issues: v.issues };
  if (v.kind === "rule") await deps.saveRule(ctx.tenantId, v.doc, draft.isNew);
  else await deps.saveScene(ctx.tenantId, v.doc, draft.isNew);
  const status = await deps.awaitApplied(v.kind, draft.id, rev, ctx.timeoutMs ?? APPLY_TIMEOUT_MS);
  return { ok: true, kind: v.kind, id: draft.id, rev, status };
}
