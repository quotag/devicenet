import { useRef } from "react";
import type { ClipboardEvent, KeyboardEvent } from "react";
import { vi } from "@/i18n/vi";
import "./ds1.css";
import "./ds2.css";

export const CODE_LENGTH = 8;
const DISALLOWED = /[^A-HJ-NP-Z2-9]/g;

/** Uppercase and drop everything outside `[A-HJ-NP-Z2-9]`. */
export function sanitizeCode(raw: string): string {
  return raw.toUpperCase().replace(DISALLOWED, "");
}

export interface CodeInputProps {
  value: string;
  onChange: (value: string) => void;
  onComplete?: (code: string) => void;
  /** Error state: red cells + shake. */
  invalid?: boolean;
  disabled?: boolean;
  autoFocus?: boolean;
  className?: string;
}

export function CodeInput({ value, onChange, onComplete, invalid, disabled, autoFocus, className }: CodeInputProps) {
  const refs = useRef<Array<HTMLInputElement | null>>([]);
  const focus = (i: number) => refs.current[Math.max(0, Math.min(CODE_LENGTH - 1, i))]?.focus();

  const commit = (next: string, focusAt: number) => {
    const v = next.slice(0, CODE_LENGTH);
    onChange(v);
    if (v.length === CODE_LENGTH && v !== value) onComplete?.(v);
    focus(focusAt);
  };

  const insertAt = (i: number, text: string) => {
    const clean = sanitizeCode(text);
    if (!clean) return;
    const pos = Math.min(i, value.length);
    // A whole-code paste replaces everything; otherwise splice in at the cell.
    const next = clean.length >= CODE_LENGTH ? clean : value.slice(0, pos) + clean + value.slice(pos + clean.length);
    commit(next, Math.min(pos + clean.length, CODE_LENGTH - 1));
  };

  const onKeyDown = (i: number, e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Backspace") {
      e.preventDefault();
      const at = i < value.length ? i : value.length - 1;
      if (at < 0) return;
      commit(value.slice(0, at) + value.slice(at + 1), at);
    } else if (e.key === "ArrowLeft") {
      e.preventDefault();
      focus(i - 1);
    } else if (e.key === "ArrowRight") {
      e.preventDefault();
      focus(i + 1);
    }
  };

  const onPaste = (i: number, e: ClipboardEvent<HTMLInputElement>) => {
    e.preventDefault();
    insertAt(i, e.clipboardData.getData("text"));
  };

  return (
    <div
      role="group"
      aria-label={vi.dn2.codeLabel}
      className={["dn-code", invalid && "dn-shake", className].filter(Boolean).join(" ")}
    >
      {Array.from({ length: CODE_LENGTH }, (_, i) => {
        const ch = value[i] ?? "";
        const active = !invalid && i === Math.min(value.length, CODE_LENGTH - 1);
        return (
          <input
            key={i}
            ref={(el) => {
              refs.current[i] = el;
            }}
            className={["codecell", "dn-num", "dn-codecell", active && "codecell-active", invalid && "codecell-bad"]
              .filter(Boolean)
              .join(" ")}
            aria-label={vi.dn2.codeCell(i + 1)}
            aria-invalid={invalid ? true : undefined}
            value={ch}
            disabled={disabled}
            autoFocus={autoFocus && i === 0}
            autoCapitalize="characters"
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
            // Handles typing, IME and mobile autofill (several chars at once).
            onChange={(e) => insertAt(i, e.target.value)}
            onKeyDown={(e) => onKeyDown(i, e)}
            onPaste={(e) => onPaste(i, e)}
            onFocus={(e) => e.currentTarget.select()}
          />
        );
      })}
    </div>
  );
}
