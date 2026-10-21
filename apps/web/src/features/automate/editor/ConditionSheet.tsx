import { useState } from "react";
import type { Device } from "@devicenet/shared";
import { Button } from "@/components/dn/Button";
import { Chip } from "@/components/dn/Chip";
import { Input } from "@/components/dn/Input";
import { SegmentedTabs } from "@/components/dn/SegmentedTabs";
import { Sheet } from "@/components/dn/Sheet";
import { vi } from "@/i18n/vi";
import { DaysChips, SelectField, SheetActions, ValueField, allowedOpsForProperty, deviceOptions, propertyOptions } from "./fields";
import type { DraftLeafCondition } from "./state";

const t = vi.s30;
const KINDS = ["property", "timeWindow", "dayOfWeek", "sun"] as const;

export interface ConditionSheetProps {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  value: DraftLeafCondition | undefined;
  devices: Device[];
  onSubmit: (c: DraftLeafCondition) => void;
  onDelete?: () => void;
}

export function ConditionSheet(p: ConditionSheetProps) {
  const isEdit = Boolean(p.value || p.onDelete);
  return (
    <Sheet open={p.open} onOpenChange={p.onOpenChange} title={isEdit ? t.editConditionBtn : t.addConditionBtn}>
      {p.open ? <Body {...p} /> : null}
    </Sheet>
  );
}

function Body({ value, devices, onSubmit, onOpenChange, onDelete }: ConditionSheetProps) {
  const [d, setD] = useState<DraftLeafCondition>(value ?? { type: "property" });
  const setKind = (i: number) => {
    const k = KINDS[i]!;
    if (k === d.type) return;
    setD(k === "property" ? { type: "property" } : k === "timeWindow" ? { type: "timeWindow" } : k === "dayOfWeek" ? { type: "dayOfWeek", days: [] } : { type: "sun", when: "afterSunset", offsetMin: 0 });
  };
  const device = d.type === "property" ? devices.find((x) => x.id === d.deviceId) : undefined;
  const propDef = device && d.type === "property" && d.property ? device.properties[d.property] : undefined;
  const ops = allowedOpsForProperty(propDef?.type, false) as Exclude<import("@devicenet/shared").CompareOp, "changed">[];

  return (
    <SheetActions>
      <SegmentedTabs label={t.addConditionBtn} items={KINDS.map((k) => t.condKind[k])} value={KINDS.indexOf(d.type)} onChange={setKind} />
      {d.type === "property" && (
        <>
          <SelectField
            label={t.device}
            value={d.deviceId}
            options={deviceOptions(devices)}
            placeholder={devices.length === 0 ? "Không có thiết bị khả dụng" : t.pick}
            onChange={(v) => setD({ type: "property", deviceId: v })}
          />
          {devices.length === 0 && (
            <span className="cap" style={{ color: "var(--text-muted)" }}>
              Không có thiết bị khả dụng trong site này
            </span>
          )}
          <SelectField
            label={t.property}
            value={d.property}
            options={propertyOptions(device)}
            onChange={(v) => {
              const nextProp = device?.properties[v];
              const nextOps = allowedOpsForProperty(nextProp?.type, false);
              const nextOp = d.op && nextOps.includes(d.op) ? d.op : undefined;
              setD({ type: "property", deviceId: d.deviceId, property: v, op: nextOp });
            }}
          />
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <span className="cap">{t.compare}</span>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {ops.map((op) => (
                <Chip key={op} selected={d.op === op} onClick={() => setD({ ...d, op })}>
                  {t.ops[op]}
                </Chip>
              ))}
            </div>
          </div>
          <ValueField device={device} property={d.property} value={d.value} onChange={(v) => setD({ ...d, value: v })} />
        </>
      )}
      {d.type === "timeWindow" && (
        <>
          <Input label={t.from} type="time" value={d.from ?? ""} onChange={(s) => setD({ ...d, from: s || undefined })} />
          <Input label={t.to} type="time" value={d.to ?? ""} onChange={(s) => setD({ ...d, to: s || undefined })} />
        </>
      )}
      {d.type === "dayOfWeek" && <DaysChips value={d.days} onChange={(days) => setD({ ...d, days })} />}
      {d.type === "sun" && (
        <>
          <SegmentedTabs
            label={t.condKind.sun}
            items={[t.afterSunrise, t.afterSunset]}
            value={d.when === "afterSunrise" ? 0 : 1}
            onChange={(i) => setD({ ...d, when: i === 0 ? "afterSunrise" : "afterSunset" })}
          />
          <Input label={t.offset} type="number" inputMode="numeric" value={String(d.offsetMin ?? 0)} onChange={(s) => setD({ ...d, offsetMin: s.trim() === "" ? 0 : Number(s) })} />
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
      {onDelete && (
        <Button
          variant="danger"
          block
          onClick={() => {
            onDelete();
            onOpenChange(false);
          }}
        >
          {t.removeCondition}
        </Button>
      )}
    </SheetActions>
  );
}
