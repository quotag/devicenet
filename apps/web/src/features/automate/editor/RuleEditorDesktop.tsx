import { useEffect, useRef, type ReactNode } from "react";
import { ArrowLeft } from "lucide-react";
import { useStore } from "zustand";
import type { Rule, RunProgress } from "@devicenet/shared";
import { Badge } from "@/components/dn/Badge";
import { Button } from "@/components/dn/Button";
import { Card } from "@/components/dn/Card";
import { Switch } from "@/components/dn/Switch";
import { EventRow } from "@/features/me/EventRow";
import { isErrorEvent, toView } from "@/features/me/history";
import { vi } from "@/i18n/vi";
import { configStore, uiStore } from "@/stores";
import { lastRunLabel, makeSummaryContext } from "../summary";
import { actionText, conditionText, triggerText } from "./summaries";
import type { EditorDraft } from "./state";

const d = vi.desktop;
const t = vi.s30;
const WEEK = 7 * 86_400_000;

export interface PreviewLine {
  label: string;
  text: string;
}

/** "Xem trước": one Vietnamese sentence per section, built from `summarizeTrigger` / `summarizeAction`. */
export function previewOf(draft: EditorDraft, cx: ReturnType<typeof makeSummaryContext>): PreviewLine[] {
  const lines: PreviewLine[] = [];
  if (draft.mode === "rule" && draft.trigger) lines.push({ label: t.when, text: triggerText(draft.trigger, cx).label });
  if (draft.mode === "rule" && draft.conditions.items.length > 0) {
    const joiner = draft.conditions.op === "all" ? " và " : " hoặc ";
    lines.push({ label: t.andIf, text: draft.conditions.items.map((c) => conditionText(c.item, cx).label).join(joiner) });
  }
  if (draft.actions.length > 0) lines.push({ label: t.then, text: draft.actions.map((a) => actionText(a.item, cx).label).join(", ") });
  return lines;
}

export interface RuleEditorDesktopProps {
  title: string;
  isRule: boolean;
  isNew: boolean;
  enabled: boolean;
  /** Saved rule doc (status / history cards); undefined for a new rule or a scene. */
  existing?: Rule;
  timezone: string;
  preview: PreviewLine[];
  /** Name/icon + Khi / Và nếu / Thì blocks (same JSX as mobile). */
  form: ReactNode;
  saving: boolean;
  lan: boolean;
  canSave: boolean;
  canTest: boolean;
  testing: boolean;
  run?: RunProgress;
  testError?: string;
  onBack: () => void;
  onEnabled: (v: boolean) => void;
  onTest: () => void;
  onSave: () => void;
}

/** D-RuleEditor (>= 900 px): header with back / name / badge / actions, left column = form, right 360 = preview, status, history, delete. */
export function RuleEditorDesktop(p: RuleEditorDesktopProps) {
  const events = useStore(configStore, (s) => s.events);
  const rules = useStore(configStore, (s) => s.rules);
  const scenes = useStore(configStore, (s) => s.scenes);
  const rule = p.existing;

  // Deleted from the SH-6 confirm dialog → leave the editor.
  const seen = useRef(false);
  const present = rule ? Boolean(rules[rule.id]) : false;
  useEffect(() => {
    if (present) seen.current = true;
    else if (seen.current) p.onBack();
  }, [present, p]);

  const mine = rule ? events.filter((e) => e.ruleId === rule.id).sort((a, b) => b.ts - a.ts) : [];
  const week = mine.filter((e) => e.ts > Date.now() - WEEK);
  const errors = week.filter(isErrorEvent).length;
  const recent = mine.slice(0, 3).map((e) => toView(e, { rules, scenes }));
  const active = p.enabled && !p.isNew;

  return (
    <div data-testid="rule-editor-desktop" style={{ display: "flex", flexDirection: "column", gap: 24 }}>
      <div className="dtitle-row">
        <div style={{ display: "flex", alignItems: "center", gap: 12, minWidth: 0 }}>
          <button type="button" className="ibtn" aria-label={d.back} onClick={p.onBack}>
            <ArrowLeft className="ic" aria-hidden="true" />
          </button>
          <h1 className="dtitle">{p.title}</h1>
          {p.isRule ? <Badge tone={active ? "ok" : "neutral"}>{active ? d.active : d.inactive}</Badge> : null}
        </div>
        <div className="dtitle-actions">
          <Button variant="ghost" onClick={p.onBack}>{t.cancel}</Button>
          <Button variant="secondary" loading={p.testing} disabled={!p.canTest} onClick={p.onTest}>{d.test}</Button>
          <span title={p.lan ? t.saveLanTip : undefined}>
            <Button variant="primary" loading={p.saving} disabled={!p.canSave} aria-label={t.save} onClick={p.onSave}>{t.save}</Button>
          </span>
        </div>
      </div>

      <div className="dre">
        <div className="dre-col" style={{ gap: 24 }}>
          {p.form}
          {p.testError ? (
            <p className="cap" role="alert" style={{ color: "var(--warning)", margin: 0 }}>{p.testError}</p>
          ) : null}
          {p.run ? (
            <ul aria-label={t.test} style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 4 }}>
              {p.run.steps.map((s) => (
                <li key={s.index} className="cap" data-status={s.status}>
                  {t.testStep(s.index + 1, t.stepStatus[s.status])}
                  {s.error ? ` · ${s.error}` : ""}
                </li>
              ))}
            </ul>
          ) : null}
        </div>

        {p.isRule ? (
          <div className="dre-col">
            <Card title={d.preview}>
              {p.preview.length === 0 ? (
                <p className="cap" style={{ margin: 0 }}>{d.previewEmpty}</p>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 4 }} data-testid="rule-preview">
                  {p.preview.map((l) => (
                    <p key={l.label} style={{ margin: 0 }}>
                      <strong>{l.label}</strong> {l.text}
                    </p>
                  ))}
                </div>
              )}
              <div className="row" style={{ marginTop: 12 }}>
                <span className="row-main">
                  <span className="lbl">{d.enable}</span>
                  <span className="cap">{p.isNew ? t.enableAfterSave : t.enableBody}</span>
                </span>
                <Switch checked={active} disabled={p.isNew} label={d.enable} onChange={p.onEnabled} />
              </div>
            </Card>

            {rule ? (
              <>
                <Card title={d.status}>
                  <div className="row"><span className="row-main"><span className="lbl">{d.hub}</span></span><span className="cap">{rule.appliedRev === rule.rev ? d.loaded(rule.rev) : d.syncing}</span></div>
                  <div className="row"><span className="row-main"><span className="lbl">{d.lastRun}</span></span><span className="cap dn-num">{rule.lastRunAt ? lastRunLabel(rule.lastRunAt, p.timezone) : d.never}</span></div>
                  <div className="row"><span className="row-main"><span className="lbl">{d.total7d}</span></span><span className="cap dn-num">{d.runs(week.length, errors)}</span></div>
                </Card>
                <Card title={d.history}>
                  {recent.length === 0 ? <p className="cap" style={{ margin: 0 }}>{d.historyEmpty}</p> : recent.map((ev) => <EventRow key={ev.id} ev={ev} compact />)}
                </Card>
                <Button variant="danger" block onClick={() => uiStore.getState().openSheet({ kind: "sh6", type: "rule", id: rule.id, step: "confirm" })}>
                  {d.delete}
                </Button>
              </>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}
