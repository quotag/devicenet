import { forwardRef, type ButtonHTMLAttributes } from 'react';
import { cx } from './cx';
import './ds1.css';

export interface ChipProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  selected?: boolean;
  /** Dashed "+ add" chip (e.g. add room). */
  add?: boolean;
}

export const Chip = forwardRef<HTMLButtonElement, ChipProps>(function Chip(
  { selected, add, className, children, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type="button"
      className={cx('dn-chip', selected && 'dn-chip-selected', add && 'dn-chip-add', className)}
      aria-pressed={add ? undefined : !!selected}
      {...rest}
    >
      {add ? '+ ' : null}
      {children}
    </button>
  );
});
