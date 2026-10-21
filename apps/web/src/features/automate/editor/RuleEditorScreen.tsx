import { useMemo, useReducer, useState } from "react";
import { useStore } from "zustand";
import { Action as ActionSchema, type Device, type Rule, type Scene } from "@devicenet/shared";
import { Banner } from "@/components/dn/Banner";
import { DeviceIcon, getIconPickerList, type DeviceIconType } from "@/components/dn/DeviceIcon";
import { Input } from "@/components/dn/Input";
import { SegmentedTabs } from "@/components/dn/SegmentedTabs";
import { Sheet } from "@/components/dn/Sheet";
import { vi } from "@/i18n/vi";
import { useIsDesktop } from "@/lib/useIsDesktop";
import { configStore, connectionStore, sessionStore, toastStore, uiStore } from "@/stores";
import { useHub, useSendCommand } from "@/transport/hooks";
import { ActionList } from "./ActionList";
import { ActionSheet } from "./ActionSheet";
import { ConditionSheet } from "./ConditionSheet";
import { EditorFooter } from "./EditorFooter";
import { BlockRow, RuleBlock } from "./RuleBlock";
import { RuleEditorDesktop, previewOf } from "./RuleEditorDesktop";
import { TriggerSheet } from "./TriggerSheet";
import { saveDraft, type SaveDeps } from "./save";
import {
  actionToWire,
  draftFromRule,
  draftFromScene,
  draftFromSuggestion,
  editorReducer,
  newDraft,
  type DraftAction,
  type DraftCondition,
  type DraftLeafCondition,
  type EditorDraft,
} from "./state";
import { actionText, conditionText, triggerText } from "./summaries";
import { validate, issueFor } from "./validate";
import { makeSummaryContext } from "../summary";
import type { EditorTarget } from "../editorTarget";

const t = vi.s30;

export function initialDraft(target: EditorTarget): EditorDraft {
  const cfg = configStore.getState();
  if (target.kind === "new") return newDraft(target.mode);
  if (target.kind === "suggestion") return draftFromSuggestion(target.draft.mode, target.draft);
  const doc = target.mode === "rule" ? cfg.rules[target.id] : cfg.scenes[target.id];
  if (!doc) return newDraft(target.mode);
  return target.mode === "rule" ? draftFromRule(doc as Rule) : draftFromScene(doc as Scene);
}

type Edit = null | { sheet: "trigger" } | { sheet: "condition"; key?: string } | { sheet: "action"; key?: string } | { sheet: "icon" };

export interface RuleEditorScreenProps {
  target: EditorTarget;
  /** Back to S-02 (Hủy, or after save). */
  onClose: () => void;
  /** Test seam: replaces the Firestore writes / appliedRev wait. */
  saveDeps?: SaveDeps;
}

export function RuleEditorScreen({ target, onClose, saveDeps }: RuleEditorScreenProps) {
  const desktop = useIsDesktop();
  const [draft, dispatch] = useReducer(editorReducer, target, initialDraft);
  const [edit, setEdit] = useState<Edit>(null);
  const [saving, setSaving] = useState<"idle" | "saving" | "syncing">("idle");
  const [runId, setRunId] = useState<string>();
  const [testing, setTesting] = useState(false);
  const [testError, setTestError] = useState<string>();

  const mode = useStore(sessionStore, (s) => s.mode);
  const tenantId = useStore(sessionStore, (s) => s.tenantId);
  const sites = useStore(configStore, (s) => s.sites);
  const uiSite = useStore(uiStore, (s) => s.siteId);
  const devicesMap = useStore(configStore, (s) => s.devices);
  const scenesMap = useStore(configStore, (s) => s.scenes);
  const rulesMap = useStore(configStore, (s) => s.rules);
  const run = useStore(connectionStore, (s) => (runId ? s.runs[runId as keyof typeof s.runs] : undefined));
  const existing = target.kind === "edit" ? (target.mode === "rule" ? rulesMap[target.id] : scenesMap[target.id]) : undefined;
  const currentSite = sites.find((s) => s.id === uiSite) ?? sites[0];
  const siteId = existing?.siteId ?? currentSite?.id;
  const hub = useHub(siteId);
  const send = useSendCommand();

  const devices = useMemo(
    () => Object.values(devicesMap).filter((d): d is Device => d.siteId === siteId && d.status === "active"),
    [devicesMap, siteId],
  );
  const scenes = useMemo(() => Object.values(scenesMap).filter((s) => s.siteId === siteId && s.id !== draft.id), [scenesMap, siteId, draft.id]);
  const cx = useMemo(() => makeSummaryContext(devicesMap, scenesMap), [devicesMap, scenesMap]);

  const isRule = draft.mode === "rule";
  const result = useMemo(
    () => validate(draft, { siteId, hubId: hub?.id }),
    [draft, siteId, hub?.id],
  );
  const lan = mode === "lan";
  const canSave = result.ok && !lan && saving === "idle" && Boolean(tenantId);

  const onSave = async () => {
    if (!tenantId || !canSave) return;
    setSaving("saving");
    try {
      const r = await saveDraft(draft, { tenantId, siteId, hubId: hub?.id }, saveDeps);
      if (!r.ok) {
        setSaving("idle");
        return;
      }
      dispatch({ type: "markSaved", rev: r.rev });
      setSaving("syncing");
      onClose();
    } catch {
      setSaving("idle");
      toastStore.getState().show({ kind: "error", text: t.saveFail });
    }
  };

  const wireActions = draft.actions.map((a) => actionToWire(a.item));
  const testable = draft.actions.length > 0 && ActionSchema.array().min(1).max(20).safeParse(wireActions).success && Boolean(hub);
  const onTest = async () => {
    if (!hub || !testable) return;
    setTesting(true);
    setTestError(undefined);
    setRunId(undefined);
    try {
      const ack = await send(hub.id, { type: "actions.test", actions: wireActions });
      const id = ack.result?.runId;
      if (!ack.ok || typeof id !== "string") setTestError(ack.message ?? t.testFail);
      else setRunId(id);
    } catch {
      setTestError(t.testFail);
    } finally {
      setTesting(false);
    }
  };

  const err = (b: string) => issueFor(result, b);
  const invalidActionKeys = result.blocks;
  const editingAction = edit?.sheet === "action" && edit.key ? draft.actions.find((a) => a.key === edit.key)?.item : undefined;
  const editingCond = edit?.sheet === "condition" && edit.key ? draft.conditions.items.find((c) => c.key === edit.key)?.item : undefined;
  const previewLines = previewOf(draft, cx);
  const title = draft.name.trim() || (isRule ? t.newRule : t.newScene);

  const form = (
    <>
    <div style={{ display: "flex", gap: 12, alignItems: "flex-end" }}>
      <button
        type="button"
        aria-label={t.iconPick}
        onClick={() => setEdit({ sheet: "icon" })}
        style={{ width: 44, height: 44, borderRadius: 12, border: "1px solid var(--border)", background: "var(--surface-2)", color: "var(--text)", display: "inline-flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}
      >
        <DeviceIcon icon={draft.icon as DeviceIconType | undefined} />
      </button>
      <Input label={t.nameLabel} value={draft.name} invalid={Boolean(err("name"))} onChange={(name) => dispatch({ type: "setName", name })} style={{ flex: 1 }} />
    </div>

    {isRule && (
      <RuleBlock title={t.when} error={err("trigger")} onAdd={() => setEdit({ sheet: "trigger" })} addLabel={`${t.add} ${t.when}`}>
        {draft.trigger ? (
          <BlockRow label={triggerText(draft.trigger, cx).label} onClick={() => setEdit({ sheet: "trigger" })} invalid={Boolean(err("trigger"))} aria-label={t.when} />
        ) : null}
      </RuleBlock>
    )}

    {isRule && (
      <RuleBlock title={t.andIf} error={err("conditions")} onAdd={() => setEdit({ sheet: "condition" })} addLabel={`${t.add} ${t.andIf}`}>
        {draft.conditions.items.length === 0 ? (
          <span className="cap">{t.conditionsEmpty}</span>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 8, paddingTop: 4 }}>
            <SegmentedTabs
              label={t.andIf}
              items={[...t.andOr]}
              value={draft.conditions.op === "all" ? 0 : 1}
              onChange={(i) => dispatch({ type: "setConditionOp", op: i === 0 ? "all" : "any" })}
            />
            {draft.conditions.items.map((c) => {
              const txt = conditionText(c.item, cx);
              return <BlockRow key={c.key} label={txt.label} caption={txt.caption} invalid={Boolean(err(`condition:${c.key}`))} onClick={() => setEdit({ sheet: "condition", key: c.key })} />;
            })}
          </div>
        )}
      </RuleBlock>
    )}

    <RuleBlock title={t.then} error={err("actions")} onAdd={() => setEdit({ sheet: "action" })} addLabel={`${t.add} ${t.then}`}>
      {draft.actions.length === 0 ? (
        <span className="cap">{t.actionsEmpty}</span>
      ) : (
        <ActionList
          actions={draft.actions}
          cx={cx}
          invalidKeys={invalidActionKeys}
          onEdit={(key) => setEdit({ sheet: "action", key })}
          onMove={(from, to) => dispatch({ type: "moveAction", from, to })}
        />
      )}
    </RuleBlock>
    </>
  );

  const sheets = (
    <>
      <TriggerSheet
        open={edit?.sheet === "trigger"}
        onOpenChange={(o) => !o && setEdit(null)}
        value={draft.trigger}
        devices={devices}
        onSubmit={(trigger) => dispatch({ type: "setTrigger", trigger })}
      />
      <ConditionSheet
        open={edit?.sheet === "condition"}
        onOpenChange={(o) => !o && setEdit(null)}
        value={editingCond && !("all" in editingCond) && !("any" in editingCond) ? (editingCond as DraftLeafCondition) : undefined}
        devices={devices}
        onSubmit={(condition: DraftCondition) =>
          edit?.sheet === "condition" && edit.key
            ? dispatch({ type: "updateCondition", key: edit.key, condition })
            : dispatch({ type: "addCondition", condition })
        }
      />
      <ActionSheet
        open={edit?.sheet === "action"}
        onOpenChange={(o) => !o && setEdit(null)}
        value={editingAction}
        devices={devices}
        scenes={scenes}
        onSubmit={(action: DraftAction) =>
          edit?.sheet === "action" && edit.key
            ? dispatch({ type: "updateAction", key: edit.key, action })
            : dispatch({ type: "addAction", action })
        }
      />
      <Sheet open={edit?.sheet === "icon"} onOpenChange={(o) => !o && setEdit(null)} title={t.iconPick}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 8 }}>
          {getIconPickerList().map((i) => (
            <button
              key={i.value}
              type="button"
              aria-label={i.label}
              aria-pressed={draft.icon === i.value}
              onClick={() => {
                dispatch({ type: "setIcon", icon: i.value });
                setEdit(null);
              }}
              style={{ minHeight: 44, borderRadius: 12, border: `1px solid ${draft.icon === i.value ? "var(--accent)" : "var(--border)"}`, background: "var(--surface-2)", color: "var(--text)", cursor: "pointer" }}
            >
              {i.icon}
            </button>
          ))}
        </div>
      </Sheet>
    </>
  );

  if (desktop) {
    return (
      <>
        <RuleEditorDesktop
          title={title}
          isRule={isRule}
          isNew={draft.isNew}
          enabled={draft.enabled}
          existing={target.kind === "edit" && target.mode === "rule" ? (existing as Rule | undefined) : undefined}
          timezone={sites.find((x) => x.id === siteId)?.timezone ?? "Asia/Ho_Chi_Minh"}
          preview={previewLines}
          form={form}
          saving={saving !== "idle"}
          lan={lan}
          canSave={canSave}
          canTest={testable && !testing}
          testing={testing}
          run={run}
          testError={testError}
          onBack={onClose}
          onEnabled={(enabled) => dispatch({ type: "setEnabled", enabled })}
          onTest={() => void onTest()}
          onSave={() => void onSave()}
        />
        {sheets}
      </>
    );
  }

  return (
    <>
      <header className="hdr" style={{ padding: "0 8px" }}>
        <div className="hdr-l">
          <button className="txtbtn" type="button" onClick={onClose}>
            {t.cancel}
          </button>
        </div>
        <span className="lbl" style={{ fontSize: 15 }}>
          {title}
        </span>
        <div className="hdr-r">
          <span title={lan ? t.saveLanTip : undefined}>
            <button className="txtbtn" type="button" style={{ fontWeight: 600 }} disabled={!canSave} aria-label={t.save} title={lan ? t.saveLanTip : undefined} onClick={() => void onSave()}>
              {t.save}
            </button>
          </span>
        </div>
      </header>
      {saving !== "idle" && <Banner kind="reconnecting">{t.syncing}</Banner>}
      <div className="body" style={{ gap: 24, padding: "16px 16px 24px", overflowY: "auto" }}>
        {form}

        <EditorFooter
          showEnable={isRule}
          enabled={draft.enabled}
          isNew={draft.isNew}
          onEnabled={(enabled) => dispatch({ type: "setEnabled", enabled })}
          canTest={testable && !testing}
          testing={testing}
          onTest={() => void onTest()}
          run={run}
          testError={testError}
        />
      </div>

      {sheets}
    </>
  );
}
