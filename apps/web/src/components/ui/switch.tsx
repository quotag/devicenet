import { Switch as SwitchPrimitive } from 'radix-ui';
import { forwardRef, type ComponentPropsWithoutRef, type ElementRef } from 'react';

/** Radix Switch primitives (role=switch, aria-checked, keyboard). Styling lives in dn/Switch. */
export const SwitchRoot = forwardRef<
  ElementRef<typeof SwitchPrimitive.Root>,
  ComponentPropsWithoutRef<typeof SwitchPrimitive.Root>
>(function SwitchRoot(props, ref) {
  return <SwitchPrimitive.Root ref={ref} {...props} />;
});

export const SwitchThumb = forwardRef<
  ElementRef<typeof SwitchPrimitive.Thumb>,
  ComponentPropsWithoutRef<typeof SwitchPrimitive.Thumb>
>(function SwitchThumb(props, ref) {
  return <SwitchPrimitive.Thumb ref={ref} {...props} />;
});
