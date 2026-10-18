import { Check } from 'lucide-react';
import { Checkbox as CheckboxPrimitive } from 'radix-ui';
import { forwardRef, type ComponentPropsWithoutRef, type ElementRef } from 'react';

/** Radix Checkbox using DeviceNet tokens (`.chk` from base.css, accent when checked). */
export const Checkbox = forwardRef<
  ElementRef<typeof CheckboxPrimitive.Root>,
  ComponentPropsWithoutRef<typeof CheckboxPrimitive.Root>
>(function Checkbox({ className, ...props }, ref) {
  const cls = [
    'chk inline-flex items-center justify-center data-[state=checked]:bg-[var(--accent)] data-[state=checked]:border-[var(--accent)]',
    className,
  ]
    .filter(Boolean)
    .join(' ');
  return (
    <CheckboxPrimitive.Root ref={ref} className={cls} {...props}>
      <CheckboxPrimitive.Indicator>
        <Check size={14} strokeWidth={3} color="var(--on-accent)" aria-hidden />
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  );
});
