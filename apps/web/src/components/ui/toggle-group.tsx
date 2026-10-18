import * as React from "react";
import { ToggleGroup as ToggleGroupPrimitive } from "radix-ui";

export const ToggleGroup = ToggleGroupPrimitive.Root;

export const ToggleGroupItem = React.forwardRef<
  React.ElementRef<typeof ToggleGroupPrimitive.Item>,
  React.ComponentPropsWithoutRef<typeof ToggleGroupPrimitive.Item>
>((props, ref) => <ToggleGroupPrimitive.Item ref={ref} {...props} />);
ToggleGroupItem.displayName = "ToggleGroupItem";
