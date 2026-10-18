import { forwardRef } from 'react';
import { BaseButton, type BaseButtonProps } from '@/components/ui/button';
import { cx } from './cx';
import './ds1.css';

export function Spinner({ className }: { className?: string }) {
  return <span className={cx('dn-spin', className)} aria-hidden="true" />;
}

export interface ButtonProps extends BaseButtonProps {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  block?: boolean;
  loading?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'primary', block, loading, className, children, disabled, ...rest },
  ref,
) {
  return (
    <BaseButton
      ref={ref}
      className={cx('dn-btn', `dn-btn-${variant}`, block && 'dn-btn-block', loading && 'dn-btn-loading', className)}
      aria-busy={loading ? true : undefined}
      disabled={disabled || loading}
      {...rest}
    >
      {loading ? <Spinner /> : null}
      {children}
    </BaseButton>
  );
});
