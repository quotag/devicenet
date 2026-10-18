import { Slot } from 'radix-ui';
import { forwardRef, type ButtonHTMLAttributes } from 'react';

export interface BaseButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** Render the child element instead of a <button> (Radix Slot). */
  asChild?: boolean;
}

/** Behaviour primitive: unstyled button with `asChild` support. Styling lives in dn/Button. */
export const BaseButton = forwardRef<HTMLButtonElement, BaseButtonProps>(function BaseButton(
  { asChild, type = 'button', ...rest },
  ref,
) {
  const Comp = asChild ? Slot.Root : 'button';
  return <Comp ref={ref} type={asChild ? undefined : type} {...rest} />;
});
