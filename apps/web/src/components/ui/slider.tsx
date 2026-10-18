import * as React from "react";
import { Slider as SliderPrimitive } from "radix-ui";

export interface SliderProps
  extends Omit<React.ComponentPropsWithoutRef<typeof SliderPrimitive.Root>, "value" | "onValueChange"> {
  value: number;
  onValueChange?: (v: number) => void;
  thumbLabel?: string;
}

/** Single-thumb Radix slider; classes are dn-slider-* (see dn/ds2.css). */
export const Slider = React.forwardRef<React.ElementRef<typeof SliderPrimitive.Root>, SliderProps>(
  ({ value, onValueChange, thumbLabel, className, ...props }, ref) => (
    <SliderPrimitive.Root
      ref={ref}
      className={className}
      value={[value]}
      onValueChange={(v) => onValueChange?.(v[0] ?? value)}
      {...props}
    >
      <SliderPrimitive.Track className="dn-slider-track">
        <SliderPrimitive.Range className="dn-slider-range" />
      </SliderPrimitive.Track>
      <SliderPrimitive.Thumb className="dn-slider-thumb" aria-label={thumbLabel} />
    </SliderPrimitive.Root>
  ),
);
Slider.displayName = "Slider";
