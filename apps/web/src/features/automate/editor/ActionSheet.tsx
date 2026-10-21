import { useState } from "react";
import type { Device, Scene } from "@devicenet/shared";
import { Button } from "@/components/dn/Button";
import { Input } from "@/components/dn/Input";
import { SegmentedTabs } from "@/components/dn/SegmentedTabs";
import { Sheet } from "@/components/dn/Sheet";
import { vi } from "@/i18n/vi";
import { SelectField, SheetActions, ValueField, deviceOptions, propertyOptions } from "./fields";
import type { DraftAction } from "./state";

const t = vi.s30;
const KINDS = ["setProperty", "delay", "runScene", "notify"] as const;
const LEVELS = ["info", "warning", "critical"] as const;

export interface ActionSheetProps {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  value: DraftAction | undefined;
  devices: Device[];
  scenes: Scene[];
  onSubmit: (a: DraftAction) => void;
}

export function ActionSheet(p: ActionSheetProps) {
  return (
    <Sheet open={p.open} onOpenChange={p.onOpenChange} title={t.addActionBtn}>
      {p.open ? <Body {...p} /> : null}
    </Sheet>
  );
}

function Body({ value, devices, scenes, onSubmit, onOpenChange }: ActionSheetProps) {
  const [d, setD] = useState<DraftAction>(value ?? { type: "setProperty" });
  const setKind = (i: number) => {
    const k = KINDS[i]!;
    if (k === d.type) return;
    setD(k === "setProperty" ? { type: "setProperty" } : k === "delay" ? { type: "delay" } : k === "runScene" ? { type: "runScene" } : { type: "notify", level: "info" });
  };
  const device = d.type === "setProperty" ? devices.find((x) => x.id === d.deviceId) : undefined;
  return (
    <SheetActions>
      <SegmentedTabs label={t.addActionBtn} items={KINDS.map((k) => t.actionKind[k])} value={KINDS.indexOf(d.type)} onChange={setKind} />
      {d.type === "setProperty" && (
        <>
          <SelectField
            label={t.device}
            value={d.deviceId}
            options={deviceOptions(devices)}
            placeholder={devices.length === 0 ? "Không có thiết bị khả dụng" : t.pick}
            onChange={(v) => setD({ type: "setProperty", deviceId: v })}
          />
          {devices.length === 0 && (
            <span className="cap" style={{ color: "var(--text-muted)" }}>
              Không có thiết bị khả dụng trong site này
            </span>
          )}
          <SelectField label={t.property} value={d.property} options={propertyOptions(device, true)} onChange={(v) => setD({ type: "setProperty", deviceId: d.deviceId, property: v })} />
          <ValueField device={device} property={d.property} value={d.value} onChange={(v) => setD({ ...d, value: v })} />
        </>
      )}
      {d.type === "delay" && (
        <Input label={t.delayMin} type="number" inputMode="decimal" value={d.minutes === undefined ? "" : String(d.minutes)} onChange={(s) => setD({ type: "delay", minutes: s.trim() === "" ? undefined : Number(s) })} />
      )}
      {d.type === "runScene" && (
        <SelectField label={t.scene} value={d.sceneId} options={scenes.map((s) => ({ value: s.id, label: s.name }))} onChange={(v) => setD({ type: "runScene", sceneId: v })} />
      )}
      {d.type === "notify" && (
        <>
          <Input label={t.notifyTitle} value={d.title ?? ""} onChange={(s) => setD({ ...d, title: s })} />
          <Input label={t.notifyBody} value={d.body ?? ""} onChange={(s) => setD({ ...d, body: s })} />
          <SegmentedTabs label={t.level} items={LEVELS.map((l) => t.levels[l])} value={LEVELS.indexOf(d.level ?? "info")} onChange={(i) => setD({ ...d, level: LEVELS[i]! })} />
        </>
      )}
      <Button
        variant="primary"
        block
        onClick={() => {
          onSubmit(d);
          onOpenChange(false);
        }}
      >
        {t.saveSheet}
      </Button>
    </SheetActions>
  );
}
