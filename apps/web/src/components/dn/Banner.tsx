import { type ReactNode } from 'react';
import { cx } from './cx';
import { Spinner } from './Button';
import './ds1.css';

export type BannerKind = 'offline' | 'lan' | 'reconnecting' | 'error' | 'neutral';

export interface BannerProps {
  kind?: BannerKind;
  action?: string;
  onAction?: () => void;
  className?: string;
  children: ReactNode;
}

export function Banner({ kind = 'neutral', action, onAction, className, children }: BannerProps) {
  return (
    <div role="status" className={cx('dn-banner', `dn-banner-${kind}`, className)}>
      {kind === 'reconnecting' ? <Spinner /> : <span className="dn-banner-dot" aria-hidden="true" />}
      <span className="dn-banner-text">{children}</span>
      {action ? (
        <button type="button" className="dn-banner-action" onClick={onAction}>
          {action}
        </button>
      ) : null}
    </div>
  );
}
