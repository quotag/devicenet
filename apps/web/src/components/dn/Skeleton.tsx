import { cx } from './cx';
import './ds1.css';

export interface SkeletonProps {
  width?: number | string;
  height?: number | string;
  className?: string;
}

/** Placeholder block while data loads. */
export function Skeleton({ width, height, className }: SkeletonProps) {
  return <div className={cx('dn-skeleton', className)} style={{ width, height }} aria-hidden="true" />;
}
