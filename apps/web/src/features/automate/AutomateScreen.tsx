import { Plus } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { useStore } from "zustand";
import { Button } from "@/components/dn/Button";
import { SegmentedTabs } from "@/components/dn/SegmentedTabs";
import { vi } from "@/i18n/vi";
import { configStore, uiStore } from "@/stores";
import { RuleCard } from "./RuleCard";
import { SceneCard } from "./SceneCard";
import { SuggestionCard } from "./SuggestionCard";
import { openEditor, type EditorTarget } from "./editorTarget";
import { buildSuggestions } from "./suggestions";
import { makeSummaryContext } from "./summary";

const SWIPE_PX = 60;

export interface AutomateScreenProps {
  /** Opens S-30 (B19 wires it through `setEditorOpener`). */
  onOpenEditor?: (t: EditorTarget) => void;
  initialTab?: 0 | 1;
}

export function AutomateScreen({ onOpenEditor = openEditor, initialTab }: AutomateScreenProps) {
  const storeTab = useStore(uiStore, (s) => s.automateTab);
  const [localTab, setLocalTab] = useState<number | undefined>(initialTab);
  const tab = localTab ?? storeTab;
  const setTab = (t: number) => {
    const val = (t === 1 ? 1 : 0) as 0 | 1;
    setLocalTab(val);
    uiStore.getState().setAutomateTab(val);
  };
  const sites = useStore(configStore, (s) => s.sites);
  const uiSite = useStore(uiStore, (s) => s.siteId);
  const devices = useStore(configStore, (s) => s.devices);
  const rulesMap = useStore(configStore, (s) => s.rules);
  const scenesMap = useStore(configStore, (s) => s.scenes);
  const site = sites.find((s) => s.id === uiSite) ?? sites[0];
  const tz = site?.timezone ?? "Asia/Ho_Chi_Minh";

  const scenes = useMemo(
    () => Object.values(scenesMap).filter((s) => !site || s.siteId === site.id).sort((a, b) => a.updatedAt - b.updatedAt || a.name.localeCompare(b.name)),
    [scenesMap, site],
  );
  const rules = useMemo(
    () => Object.values(rulesMap).filter((r) => !site || r.siteId === site.id).sort((a, b) => a.updatedAt - b.updatedAt || a.name.localeCompare(b.name)),
    [rulesMap, site],
  );
  const cx = useMemo(() => makeSummaryContext(devices, scenesMap), [devices, scenesMap]);
  const siteDevices = useMemo(() => Object.values(devices).filter((d) => !site || d.siteId === site.id), [devices, site]);

  const scene = tab === 0;
  const a = vi.automate;
  const items = scene ? scenes : rules;
  const suggestions = useMemo(() => buildSuggestions(siteDevices, scene ? "scene" : "rule"), [siteDevices, scene]);

  const touchX = useRef<number | null>(null);
  const onSwipeEnd = (x: number) => {
    if (touchX.current === null) return;
    const dx = x - touchX.current;
    touchX.current = null;
    if (dx <= -SWIPE_PX) setTab(1);
    else if (dx >= SWIPE_PX) setTab(0);
  };

  const create = () => onOpenEditor({ kind: "new", mode: scene ? "scene" : "rule" });
  const openSheet = uiStore.getState().openSheet;

  return (
    <>
      <header className="hdr">
        <div className="hdr-l">
          <h1 className="title">{a.title}</h1>
        </div>
        <div className="hdr-r">
          <button className="ibtn" type="button" aria-label={a.create} onClick={() => openSheet({ kind: "sh2", ctx: "automate" })}>
            <Plus className="ic" aria-hidden="true" />
          </button>
        </div>
      </header>
      <div
        className="body"
        style={{ gap: items.length ? 12 : 16, padding: "12px 16px 0", overflowY: "auto" }}
        onTouchStart={(e) => (touchX.current = e.touches[0]?.clientX ?? null)}
        onTouchEnd={(e) => onSwipeEnd(e.changedTouches[0]?.clientX ?? 0)}
      >
        <SegmentedTabs items={[...a.tabs]} value={tab} onChange={setTab} label={a.title} />

        {items.length === 0 ? (
          <>
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 8, padding: "24px 16px 8px", textAlign: "center" }}>
              <span className="lbl" style={{ fontSize: 20, lineHeight: "26px", fontWeight: 600, whiteSpace: "normal" }}>
                {scene ? a.emptyScene : a.emptyRule}
              </span>
              <p className="body-t" style={{ color: "var(--text-muted)" }}>
                {scene ? a.emptySceneBody : a.emptyRuleBody}
              </p>
            </div>
            {suggestions.length ? <span className="cap">{a.suggestions}</span> : null}
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {suggestions.map((s) => (
                <SuggestionCard key={s.key} s={s} onPick={(x) => onOpenEditor({ kind: "suggestion", draft: x.draft })} />
              ))}
            </div>
            <Button variant="primary" block style={{ width: "100%", marginTop: 8 }} onClick={create}>
              {scene ? a.ctaScene : a.ctaRule}
            </Button>
          </>
        ) : scene ? (
          <>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 16 }}>
              {scenes.map((s) => (
                <SceneCard key={s.id} scene={s} onLongPress={openSheet} />
              ))}
            </div>
            <p className="cap" style={{ textAlign: "center" }}>
              {a.hint}
            </p>
          </>
        ) : (
          rules.map((r) => (
            <RuleCard
              key={r.id}
              rule={r}
              cx={cx}
              timezone={tz}
              onOpen={(id) => onOpenEditor({ kind: "edit", mode: "rule", id })}
              onLongPress={openSheet}
            />
          ))
        )}
      </div>
    </>
  );
}
