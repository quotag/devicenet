import type { Rule, SummaryContext } from "@devicenet/shared";
import { summarizeTrigger } from "@devicenet/shared";
import { Badge } from "@/components/dn/Badge";
import { Switch } from "@/components/dn/Switch";
import { vi } from "@/i18n/vi";
import { toastStore } from "@/stores/toast";
import { useConfigWrites } from "@/transport/hooks";
import { sh6Sheet } from "./editorTarget";
import { lastRunLabel } from "./summary";
import { useLongPress } from "./useLongPress";

export function isRuleBroken(r: Pick<Rule, "brokenReason" | "lastResult">): boolean {
  return Boolean(r.brokenReason) || r.lastResult === "broken";
}
export function isRuleSyncing(r: Pick<Rule, "rev" | "appliedRev">): boolean {
  return r.appliedRev !== r.rev;
}

export interface RuleCardProps {
  rule: Rule;
  cx: SummaryContext;
  timezone: string;
  onOpen: (ruleId: string) => void;
  /** SH-6 hook point (B21). */
  onLongPress?: (sheet: ReturnType<typeof sh6Sheet>) => void;
  now?: number;
}

export function RuleCard({ rule, cx, timezone, onOpen, onLongPress, now }: RuleCardProps) {
  const writes = useConfigWrites();
  const broken = isRuleBroken(rule);
  const syncing = !broken && isRuleSyncing(rule);
  const failed = rule.lastResult === "failed" || rule.lastResult === "partial";
  const last = rule.lastRunAt ? lastRunLabel(rule.lastRunAt, timezone, now) : undefined;
  const a = vi.automate;

  const lp = useLongPress(() => onLongPress?.(sh6Sheet("rule", rule.id)));

  let note: string;
  if (broken) note = rule.brokenReason ? rule.brokenReason : a.brokenFallback;
  else if (syncing) note = a.savedSyncing;
  else if (!rule.enabled) note = a.disabledLastRun(last);
  else note = last ? a.lastRun(last) : a.neverRun;

  const toggle = (next: boolean) => {
    if (!writes) return;
    writes.setRuleEnabled(rule.id, next, rule.rev).catch(() => {
      toastStore.getState().show({ kind: "error", text: a.ruleToggleError });
    });
  };

  return (
    <div
      className="card"
      style={{ display: "flex", flexDirection: "column", gap: 8, color: "var(--text)", borderRadius: 12, cursor: "pointer" }}
      onClick={() => {
        if (lp.shouldIgnoreClick()) return;
        onOpen(rule.id);
      }}
      {...lp.handlers}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <button
          type="button"
          className="row-main"
          style={{ background: "transparent", border: 0, padding: 0, textAlign: "left", color: "inherit", font: "inherit", cursor: "pointer" }}
          onClick={(e) => {
            e.stopPropagation();
            if (lp.shouldIgnoreClick()) return;
            onOpen(rule.id);
          }}
        >
          <span className="lbl">{rule.name}</span>
          <span className="cap">{summarizeTrigger(rule.trigger, cx)}</span>
        </button>
        <span onClick={(e) => e.stopPropagation()} onPointerDown={(e) => e.stopPropagation()}>
          <Switch
            checked={rule.enabled && !broken}
            pending={syncing}
            disabled={broken || !writes}
            label={broken ? a.ruleBroken : syncing ? a.ruleSyncing(rule.name) : a.ruleToggle(rule.name)}
            onChange={toggle}
          />
        </span>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        {broken || failed ? (
          <Badge tone="error">{a.badgeError}</Badge>
        ) : syncing ? (
          <Badge tone="syncing">{a.badgeSyncing}</Badge>
        ) : rule.enabled ? (
          <Badge tone="ok">{a.badgeOk}</Badge>
        ) : null}
        <span className="cap dn-num">{note}</span>
      </div>
    </div>
  );
}
