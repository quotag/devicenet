import { forwardRef, useId, type InputHTMLAttributes } from 'react';
import { cx } from './cx';
import './ds1.css';

export interface InputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'onChange'> {
  label?: string;
  hint?: string;
  unit?: string;
  invalid?: boolean;
  shake?: boolean;
  onChange?: (value: string) => void;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { label, hint, unit, invalid, shake, onChange, id, disabled, className, ...rest },
  ref,
) {
  const auto = useId();
  const inputId = id ?? auto;
  const hintId = hint ? `${inputId}-hint` : undefined;
  return (
    <div className={cx('dn-field', invalid && 'dn-field-invalid', disabled && 'dn-field-disabled', className)}>
      {label ? (
        <label className="dn-field-label" htmlFor={inputId}>
          {label}
        </label>
      ) : null}
      <span className={cx('dn-input', invalid && 'dn-input-invalid', shake && 'dn-shake')}>
        <input
          ref={ref}
          id={inputId}
          disabled={disabled}
          aria-invalid={invalid ? true : undefined}
          aria-describedby={hintId}
          onChange={(e) => onChange?.(e.target.value)}
          {...rest}
        />
        {unit ? <span className="dn-input-unit">{unit}</span> : null}
      </span>
      {hint ? (
        <span id={hintId} className="dn-field-hint">
          {hint}
        </span>
      ) : null}
    </div>
  );
});
