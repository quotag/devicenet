import { vi } from "@/i18n/vi";
import "./ds2.css";

export interface StepperProps {
  steps: string[];
  /** 0-based current step. */
  current: number;
  label?: string;
  className?: string;
}

export function Stepper({ steps, current, label, className }: StepperProps) {
  return (
    <ol className={["dn-stepper", className].filter(Boolean).join(" ")} aria-label={label ?? vi.dn2.steps}>
      {steps.map((text, i) => {
        const state = i < current ? "done" : i === current ? "current" : "upcoming";
        return (
          <li
            key={i}
            className={`dn-step dn-step-${state}`}
            aria-current={state === "current" ? "step" : undefined}
          >
            <span className="dn-step-dot">{state === "done" ? "✓" : String(i + 1)}</span>
            <span className="dn-step-label">{text}</span>
            <span className="dn-step-line" aria-hidden="true" />
          </li>
        );
      })}
    </ol>
  );
}
