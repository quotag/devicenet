/**
 * Draft → shared `Rule` / `Scene` safeParse (FR-F08: Save disabled until parse OK).
 * Issues are mapped to editor blocks so the UI can put a `warning` border + message on them.
 */
import type { ZodIssue } from "zod";
import { Rule, Scene } from "@devicenet/shared";
import { toWire, type EditorDraft } from "./state";
import { zodIssueToVi } from "./zodVi";

/** "name" | "trigger" | "conditions" | "condition:<key>" | "actions" | "action:<key>" | "general" */
export type BlockId = string;

export interface EditorIssue {
  block: BlockId;
  path: (string | number)[];
  message: string;
}

export interface ValidateContext {
  siteId: string | undefined;
  /** Hub of the site (v1: exactly one). */
  hubId: string | undefined;
  /** Rev to stamp on the doc; default `draft.rev + 1` (the rev Save will write). */
  rev?: number;
  updatedAt?: number;
}

export type ValidateResult =
  | { ok: true; doc: Rule; kind: "rule"; issues: []; blocks: Set<BlockId> }
  | { ok: true; doc: Scene; kind: "scene"; issues: []; blocks: Set<BlockId> }
  | { ok: false; issues: EditorIssue[]; blocks: Set<BlockId> };

export function buildCandidate(draft: EditorDraft, ctx: ValidateContext): Record<string, unknown> {
  return {
    id: draft.id,
    siteId: ctx.siteId,
    hubId: ctx.hubId,
    ...toWire(draft),
    rev: ctx.rev ?? draft.rev + 1,
    updatedAt: ctx.updatedAt ?? Date.now(),
  };
}

/**
 * Zod reports union failures as one `invalid_union` with every branch's errors. The draft tells us
 * which branch the user meant, so pick that branch instead of guessing:
 *  - `conditions` group: branch 0 = `{all}`, 1 = `{any}`;
 *  - a condition item: branch 0 = leaf (has `type`), 1 = nested group.
 */
function flatten(issues: ZodIssue[], candidate: Record<string, unknown>): ZodIssue[] {
  const out: ZodIssue[] = [];
  const at = (path: (string | number)[]): unknown =>
    path.reduce<unknown>((o, k) => (o && typeof o === "object" ? (o as Record<string | number, unknown>)[k] : undefined), candidate);
  for (const i of issues) {
    if (i.code !== "invalid_union") { out.push(i); continue; }
    const node = at(i.path);
    let branch = 0;
    if (i.path.length === 1 && i.path[0] === "conditions") branch = node && typeof node === "object" && "any" in node ? 1 : 0;
    else if (node && typeof node === "object" && !("type" in node)) branch = 1;
    const chosen = i.unionErrors[branch] ?? i.unionErrors[0];
    if (!chosen) { out.push(i); continue; }
    out.push(...flatten(chosen.issues, candidate));
  }
  return out;
}

function blockOf(path: (string | number)[], draft: EditorDraft): BlockId {
  const [root, a, b] = path;
  if (root === "name" || root === "icon") return "name";
  if (root === "trigger") return "trigger";
  if (root === "actions") {
    if (typeof a === "number") return `action:${draft.actions[a]?.key ?? a}`;
    return "actions";
  }
  if (root === "conditions") {
    if (typeof b === "number") return `condition:${draft.conditions.items[b]?.key ?? b}`;
    return "conditions";
  }
  return "general";
}

export function validate(draft: EditorDraft, ctx: ValidateContext): ValidateResult {
  const candidate = buildCandidate(draft, ctx);
  const res = draft.mode === "rule" ? Rule.safeParse(candidate) : Scene.safeParse(candidate);
  if (res.success) {
    return draft.mode === "rule"
      ? { ok: true, kind: "rule", doc: res.data as Rule, issues: [], blocks: new Set() }
      : { ok: true, kind: "scene", doc: res.data as Scene, issues: [], blocks: new Set() };
  }
  const issues: EditorIssue[] = [];
  const seen = new Set<string>();
  for (const i of flatten(res.error.issues, candidate)) {
    const block = blockOf(i.path, draft);
    const message = zodIssueToVi(i);
    const dedupe = `${block}|${message}`;
    if (seen.has(dedupe)) continue;
    seen.add(dedupe);
    issues.push({ block, path: i.path, message });
  }
  return { ok: false, issues, blocks: new Set(issues.map((i) => i.block)) };
}

/** First message for a block (one error line under each card). */
export function issueFor(result: ValidateResult, block: BlockId): string | undefined {
  return result.issues.find((i) => i.block === block)?.message;
}
