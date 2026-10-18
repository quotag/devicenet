import { SwitchRoot, SwitchThumb } from '@/components/ui/switch';
import { cx } from './cx';
import { Spinner } from './Button';
import './ds1.css';

export interface SwitchProps {
  checked: boolean;
  /** Command sent, awaiting ack: spinner in knob, input blocked. */
  pending?: boolean;
  disabled?: boolean;
  /** Accessible name (required). */
  label: string;
  onChange?: (next: boolean) => void;
  className?: string;
}

export function Switch({ checked, pending, disabled, label, onChange, className }: SwitchProps) {
  return (
    <SwitchRoot
      checked={checked}
      onCheckedChange={(v) => onChange?.(v)}
      disabled={disabled || pending}
      aria-label={label}
      aria-busy={pending ? true : undefined}
      className={cx('dn-switch', pending && 'dn-switch-pending', className)}
    >
      <SwitchThumb className="dn-switch-knob">{pending ? <Spinner /> : null}</SwitchThumb>
    </SwitchRoot>
  );
}
