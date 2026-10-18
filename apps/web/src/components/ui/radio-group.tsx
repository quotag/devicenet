import * as React from "react";
import { RadioGroup as RadioGroupPrimitive } from "radix-ui";

export const RadioGroup = RadioGroupPrimitive.Root;

export const RadioGroupItem = React.forwardRef<
  React.ElementRef<typeof RadioGroupPrimitive.Item>,
  React.ComponentPropsWithoutRef<typeof RadioGroupPrimitive.Item>
>(({ children, ...props }, ref) => (
  <RadioGroupPrimitive.Item ref={ref} {...props}>
    {children}
    <RadioGroupPrimitive.Indicator />
  </RadioGroupPrimitive.Item>
));
RadioGroupItem.displayName = "RadioGroupItem";
