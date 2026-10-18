import { Slider as UiSlider } from "../ui/slider";
import "./ds1.css";
import "./ds2.css";

export interface SliderProps {
  value?: number | null;
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
  label?: string;
  pending?: boolean;
  disabled?: boolean;
  readOnly?: boolean;
  onChange?: (v: number) => void;
  className?: string;
}

export function Slider({
  value,
  min = 0,
  max = 100,
  step = 1,
  unit,
  label,
  pending,
  disabled,
  readOnly,
  onChange,
  className,
}: SliderProps) {
  const v = value ?? min;
  return (
    <div
      className={[
        "dn-slider",
        disabled && "dn-slider-disabled",
        pending && "dn-slider-pending",
        readOnly && "dn-slider-readonly",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <UiSlider
        className="dn-slider-root"
        value={v}
        min={min}
        max={max}
        step={step}
        disabled={disabled}
        aria-busy={pending ? true : undefined}
        thumbLabel={label}
        onValueChange={(n) => {
          if (!readOnly) onChange?.(n);
        }}
      />
      <span className="dn-slider-box dn-num">
        {pending ? <span className="dn-spin" aria-hidden="true" /> : String(v)}
        {unit ? <small>{unit}</small> : null}
      </span>
    </div>
  );
}
