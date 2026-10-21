import { useState } from "react";
import type { Device } from "@devicenet/shared";
import { Button } from "@/components/dn/Button";
import { Chip } from "@/components/dn/Chip";
import { Input } from "@/components/dn/Input";
import { SegmentedTabs } from "@/components/dn/SegmentedTabs";
import { Sheet } from "@/components/dn/Sheet";
import { vi } from "@/i18n/vi";
import { DaysChips, OPS_ORDER, SelectField, SheetActions, ValueField, deviceOptions, propertyOptions } from "./fields";
import type { DraftTrigger } from "./state";

const t = vi.s30;
const KINDS = ["property", "schedule", "sun"] as const;

export interface TriggerSheetProps {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  value: DraftTrigger | undefined;
  devices: Device[];
  onSubmit: (t: DraftTrigger) => void;
}

export function TriggerSheet(p: TriggerSheetProps) {
  // Body mounts only while open so its local state resets from `value` each time.
  return (
    <Sheet open={p.open} onOpenChange={p.onOpenChange} title={t.pickTrigger}>
      {p.open ? <Body {...p} /> : null}
    </Sheet>
  );
}

function Body({ value, devices, onSubmit, onOpenChange }: TriggerSheetProps) {
  const [d, setD] = useState<DraftTrigger>(value ?? { type: "property" });
  const setKind = (i: number) => {
    const k = KINDS[i]!;
    if (k !== d.type) setD(k === "property" ? { type: "property" } : k === "schedule" ? { type: "schedule" } : { type: "sun", event: "sunrise", offsetMin: 0 });
  };
  const device = d.type === "property" ? devices.find((x) => x.id === d.deviceId) : undefined;
  return (
    <SheetActions>
      <SegmentedTabs label={t.pickTrigger} items={[t.trigger.device, t.trigger.time, t.trigger.sun]} value={KINDS.indexOf(d.type)} onChange={setKind} />
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
          <SelectField label={t.property} value={d.property} options={propertyOptions(device)} onChange={(v) => setD({ type: "property", deviceId: d.deviceId, property: v })} />
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <span className="cap">{t.compare}</span>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {OPS_ORDER.map((op) => (
                <Chip
                  key={op}
                  selected={d.op === op}
                  onClick={() => setD(op === "changed" ? { ...d, op, value: undefined, forMin: undefined } : { ...d, op })}
                >
                  {t.ops[op]}
                </Chip>
              ))}
            </div>
            {d.op === "changed" && <span className="cap">{t.changedHint}</span>}
          </div>
          {d.op && d.op !== "changed" && (
            <>
              <ValueField device={device} property={d.property} value={d.value} onChange={(v) => setD({ ...d, value: v })} />
              <Input
                label={t.forMin}
                type="number"
                inputMode="numeric"
                value={d.forMin === undefined ? "" : String(d.forMin)}
                onChange={(s) => setD({ ...d, forMin: s.trim() === "" ? undefined : Number(s) })}
              />
            </>
          )}
        </>
      )}
      {d.type === "schedule" && (
        <>
          <Input label={t.at} type="time" value={d.at ?? ""} onChange={(s) => setD({ ...d, at: s || undefined })} />
          <DaysChips value={d.days} onChange={(days) => setD({ ...d, days })} />
        </>
      )}
      {d.type === "sun" && (
        <>
          <SegmentedTabs
            label={t.trigger.sun}
            items={[t.sunrise, t.sunset]}
            value={d.event === "sunset" ? 1 : d.event === "sunrise" ? 0 : -1}
            onChange={(i) => setD({ ...d, event: i === 0 ? "sunrise" : "sunset" })}
          />
          <Input
            label={t.offset}
            type="number"
            inputMode="numeric"
            value={String(d.offsetMin ?? 0)}
            onChange={(s) => setD({ ...d, offsetMin: s.trim() === "" ? 0 : Number(s) })}
          />
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
        {t.addTrigger}
      </Button>
    </SheetActions>
  );
}
