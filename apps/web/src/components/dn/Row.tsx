import { ChevronRight } from 'lucide-react';
import { type ReactNode } from 'react';
import { cx } from './cx';
import './ds1.css';

export interface RowProps {
  icon?: ReactNode;
  label: ReactNode;
  hint?: ReactNode;
  /** Right-side node (badge, switch, value). */
  trailing?: ReactNode;
  /** Show chevron; implied when onClick is set. */
  chevron?: boolean;
  onClick?: () => void;
  className?: string;
}

export function Row({ icon, label, hint, trailing, chevron, onClick, className }: RowProps) {
  const showChevron = chevron ?? !!onClick;
  const content = (
    <>
      {icon ? (
        <span className="dn-listrow-icon" aria-hidden="true">
          {icon}
        </span>
      ) : null}
      <span className="dn-listrow-main">
        <span className="dn-listrow-label">{label}</span>
        {hint ? <span className="dn-listrow-hint">{hint}</span> : null}
      </span>
      {trailing ? <span className="dn-listrow-trailing">{trailing}</span> : null}
      {showChevron ? <ChevronRight className="dn-listrow-chev" aria-hidden="true" /> : null}
    </>
  );
  if (onClick) {
    return (
      <button type="button" className={cx('dn-listrow', className)} onClick={onClick}>
        {content}
      </button>
    );
  }
  return <div className={cx('dn-listrow', className)}>{content}</div>;
}
