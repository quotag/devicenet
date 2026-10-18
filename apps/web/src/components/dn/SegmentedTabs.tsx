import { ToggleGroup, ToggleGroupItem } from "../ui/toggle-group";
import "./ds2.css";

export interface SegmentedTabsProps {
  items: string[];
  /** Selected index. */
  value: number;
  onChange?: (index: number) => void;
  label?: string;
  className?: string;
}

export function SegmentedTabs({ items, value, onChange, label, className }: SegmentedTabsProps) {
  return (
    <ToggleGroup
      type="single"
      aria-label={label}
      className={["dn-seg", className].filter(Boolean).join(" ")}
      value={String(value)}
      onValueChange={(v) => {
        if (v !== "") onChange?.(Number(v)); // ignore deselect
      }}
    >
      {items.map((text, i) => (
        <ToggleGroupItem key={i} value={String(i)} className="dn-seg-item" aria-selected={i === value}>
          {text}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
}
