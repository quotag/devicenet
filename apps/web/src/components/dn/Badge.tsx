import { type ReactNode } from 'react';
import { cx } from './cx';
import './ds1.css';

export type BadgeTone = 'neutral' | 'new' | 'ok' | 'error' | 'syncing';

export interface BadgeProps {
  tone?: BadgeTone;
  /** Hide the leading dot. */
  plain?: boolean;
  className?: string;
  children: ReactNode;
}

export function Badge({ tone = 'neutral', plain, className, children }: BadgeProps) {
  return <span className={cx('dn-badge', `dn-badge-${tone}`, plain && 'dn-badge-plain', className)}>{children}</span>;
}
