import type { ReactNode } from "react";
import type { CompareOp, Device, PropertyValue } from "@devicenet/shared";
import { Chip } from "@/components/dn/Chip";
import { Input } from "@/components/dn/Input";
import { SegmentedTabs } from "@/components/dn/SegmentedTabs";
import { vi } from "@/i18n/vi";

const t = vi.s30;

export const OPS_ORDER: CompareOp[] = ["lt", "lte", "eq", "neq", "gte", "gt", "changed"];

export function SelectField({
  label,
  value,
  onChange,
  options,
  invalid,
}: {
  label: string;
  value: string | undefined;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
  invalid?: boolean;
}) {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <span className="cap">{label}</span>
      <select
        aria-label={label}
        aria-invalid={invalid || undefined}
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value)}
        style={{ minHeight: 44, borderRadius: 12, border: "1px solid var(--border)", background: "var(--surface-2)", color: "var(--text)", padding: "0 12px", font: "inherit" }}
      >
        <option value="" disabled>
          {t.pick}
        </option>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

export function DaysChips({ value, onChange }: { value: number[] | undefined; onChange: (d: number[]) => void }) {
  const sel = value ?? [];
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <span className="cap">{t.days}</span>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        {t.dayShort.map((d, i) => (
          <Chip
            key={i}
            selected={sel.includes(i)}
            onClick={() => onChange(sel.includes(i) ? sel.filter((x) => x !== i) : [...sel, i].sort())}
          >
            {d}
          </Chip>
        ))}
      </div>
    </div>
  );
}

export function deviceOptions(devices: Device[]) {
  return devices.map((d) => ({ value: d.id, label: d.name }));
}

export function propertyOptions(d: Device | undefined, writableOnly = false) {
  if (!d) return [];
  return Object.values(d.properties)
    .filter((p) => (p.type === "binary" || p.type === "numeric" || p.type === "enum") && (!writableOnly || p.access !== "r"))
    .map((p) => ({ value: p.key, label: p.label }));
}

/** Value control chosen by the property type (binary: Bật/Tắt, enum: select, numeric: number input + unit). */
export function ValueField({
  device,
  property,
  value,
  onChange,
  invalid,
}: {
  device: Device | undefined;
  property: string | undefined;
  value: PropertyValue | undefined;
  onChange: (v: PropertyValue | undefined) => void;
  invalid?: boolean;
}) {
  const p = device && property ? device.properties[property] : undefined;
  if (!p) return null;
  if (p.type === "binary")
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        <span className="cap">{t.value}</span>
        <SegmentedTabs
          label={t.value}
          items={[p.trueLabel ?? t.on, p.falseLabel ?? t.off]}
          value={value === true ? 0 : value === false ? 1 : -1}
          onChange={(i) => onChange(i === 0)}
        />
      </div>
    );
  if (p.type === "enum")
    return (
      <SelectField
        label={t.value}
        value={typeof value === "string" ? value : undefined}
        invalid={invalid}
        onChange={(v) => onChange(v)}
        options={p.values.map((v) => ({ value: v, label: p.valueLabels?.[v] ?? v }))}
      />
    );
  return (
    <Input
      label={t.value}
      type="number"
      inputMode="decimal"
      unit={p.type === "numeric" ? p.unit : undefined}
      invalid={invalid}
      value={typeof value === "number" ? String(value) : ""}
      onChange={(s) => onChange(s.trim() === "" || Number.isNaN(Number(s)) ? undefined : Number(s))}
    />
  );
}

export function SheetActions({ children }: { children: ReactNode }) {
  return <div style={{ display: "flex", flexDirection: "column", gap: 12, padding: "4px 0 8px" }}>{children}</div>;
}
