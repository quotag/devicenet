import { useState, type ReactNode } from "react";
import type { Property, PropertyValue } from "@devicenet/shared";
import { Row } from "@/components/dn/Row";
import { SegmentedTabs } from "@/components/dn/SegmentedTabs";
import { Slider } from "@/components/dn/Slider";
import { Switch } from "@/components/dn/Switch";
import { vi } from "@/i18n/vi";

export interface PropertyControlProps {
  prop: Property;
  value: PropertyValue | undefined;
  pending?: boolean;
  disabled?: boolean;
  onSet: (key: string, value: unknown) => void;
}

export function isWritable(p: Property): boolean {
  return p.access === "w" || p.access === "rw";
}

type NumericProp = Extract<Property, { type: "numeric" }>;

function NumberBox({ prop, value, disabled, onSet }: { prop: NumericProp; value: number | undefined; disabled?: boolean; onSet: (v: number) => void }) {
  const [draft, setDraft] = useState<string | null>(null);
  const commit = () => {
    if (draft === null) return;
    const n = Number(draft.replace(",", "."));
    setDraft(null);
    if (Number.isFinite(n)) onSet(Math.min(prop.max ?? n, Math.max(prop.min ?? n, n)));
  };
  return (
    <input
      type="text"
      inputMode="decimal"
      className="dn-input dn-num"
      style={{ width: 72 }}
      aria-label={vi.s20.numberInput(prop.label)}
      disabled={disabled}
      value={draft ?? (value === undefined ? "" : String(value))}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => e.key === "Enter" && commit()}
    />
  );
}

/** One writable property: binary → Switch, numeric → Slider + number box, enum ≤ 4 → tabs, > 4 → select. */
export function PropertyControl({ prop, value, pending, disabled, onSet }: PropertyControlProps) {
  const hint = `${prop.key} · ${prop.access}${disabled ? ` · ${vi.s20.disabled}` : ""}`;
  let control: ReactNode = null;
  let stacked: ReactNode = null;

  if (prop.type === "binary") {
    control = <Switch checked={value === true} pending={pending} disabled={disabled} label={prop.label} onChange={(v) => onSet(prop.key, v)} />;
  } else if (prop.type === "numeric") {
    const n = typeof value === "number" ? value : undefined;
    stacked = (
      <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "0 12px 12px" }}>
        <div style={{ flex: 1 }}>
          <Slider value={n} min={prop.min ?? 0} max={prop.max ?? 100} step={prop.step ?? 1} unit={prop.unit} label={prop.label} pending={pending} disabled={disabled} onChange={(v) => onSet(prop.key, v)} />
        </div>
        <NumberBox prop={prop} value={n} disabled={disabled || pending} onSet={(v) => onSet(prop.key, v)} />
      </div>
    );
  } else if (prop.type === "enum") {
    const labels = prop.values.map((v) => prop.valueLabels?.[v] ?? v);
    if (prop.values.length <= 4) {
      control = (
        <SegmentedTabs
          items={labels}
          value={prop.values.indexOf(String(value))}
          label={prop.label}
          onChange={disabled || pending ? undefined : (i) => onSet(prop.key, prop.values[i])}
        />
      );
    } else {
      control = (
        <select
          className="dn-input"
          aria-label={prop.label}
          disabled={disabled || pending}
          value={typeof value === "string" ? value : ""}
          onChange={(e) => onSet(prop.key, e.target.value)}
        >
          {typeof value !== "string" ? <option value="" /> : null}
          {prop.values.map((v, i) => (
            <option key={v} value={v}>
              {labels[i]}
            </option>
          ))}
        </select>
      );
    }
  } else {
    return null;
  }

  return (
    <>
      <Row label={prop.label} hint={hint} trailing={control} />
      {stacked}
    </>
  );
}
