/** Zod issue (from shared `Rule`/`Scene` parse) → Vietnamese message (FR-F08 "Invalid"). */
import type { ZodIssue } from "zod";
import { vi } from "@/i18n/vi";

export type ErrorKey = keyof typeof vi.s30.errors;

const E = vi.s30.errors;

/** Message text of the custom issues raised by shared `Trigger.superRefine`. */
const CUSTOM: Record<string, ErrorKey> = {
  "op=changed takes no value/for": "changedNoValue",
  "value required": "valueRequired",
};

export function zodIssueKey(issue: ZodIssue): ErrorKey {
  const path = issue.path;
  const last = [...path].reverse().find((p): p is string => typeof p === "string");
  const root = path[0];
  const tooBig = issue.code === "too_big";

  if (issue.code === "custom" && CUSTOM[issue.message]) return CUSTOM[issue.message]!;

  if (root === "hubId" || root === "siteId") return "noHub";
  if (root === "name") return tooBig ? "nameMax" : "nameRequired";
  if (root === "icon") return "iconMax";
  if (root === "trigger" && path.length === 1) return "triggerRequired";
  if (root === "actions" && path.length === 1) return tooBig ? "actionsMax" : "actionsMin";
  if (root === "conditions" && tooBig) return "conditionsMax";

  // Missing discriminator → the block has no kind chosen yet.
  if (last === "type") return root === "trigger" ? "triggerRequired" : "invalid";

  switch (last) {
    case "deviceId": return "deviceRequired";
    case "property": return "propertyRequired";
    case "op": return "opRequired";
    case "value": return "valueRequired";
    case "for": return "forRange";
    case "seconds": return "delayRange";
    case "at":
    case "from":
    case "to": return "timeRequired";
    case "days": return "daysRequired";
    case "event":
    case "when": return "sunEventRequired";
    case "offsetMin": return "offsetRange";
    case "sceneId": return "sceneRequired";
    case "title": return tooBig ? "notifyTitleMax" : "notifyTitleRequired";
    case "body": return "notifyBodyMax";
  }
  return "invalid";
}

export function zodIssueToVi(issue: ZodIssue): string {
  return E[zodIssueKey(issue)];
}
