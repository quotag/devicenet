import { type ReactNode } from 'react';
import { cx } from './cx';
import './ds1.css';

export interface CardProps {
  title?: ReactNode;
  /** Node in the top-right corner (e.g. icon button). */
  action?: ReactNode;
  state?: 'default' | 'empty' | 'invalid';
  error?: ReactNode;
  on?: boolean;
  highlight?: boolean;
  className?: string;
  children?: ReactNode;
}

export function Card({ title, action, state = 'default', error, on, highlight, className, children }: CardProps) {
  return (
    <section
      className={cx(
        'dn-card',
        state === 'empty' && 'dn-card-empty',
        state === 'invalid' && 'dn-card-invalid',
        on && 'dn-card-on',
        highlight && 'dn-card-highlight',
        className,
      )}
    >
      {title || action ? (
        <header className="dn-card-head">
          <span className="dn-card-title">{title}</span>
          {action ?? null}
        </header>
      ) : null}
      <div className="dn-card-body">{children}</div>
      {error ? (
        <div className="dn-card-error" role="alert">
          {error}
        </div>
      ) : null}
    </section>
  );
}
