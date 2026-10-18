import { useEffect, useRef, useState } from "react";
import { vi } from "@/i18n/vi";
import "./ds2.css";

const R = 64;
const C = 2 * Math.PI * R; // ~402

export interface CountdownRingProps {
  remainingMs: number;
  totalMs: number;
  className?: string;
}

/**
 * Render-only countdown: the parent owns the clock (hub time); this repaints
 * every 250 ms by extrapolating from the last `remainingMs` it received.
 */
export function CountdownRing({ remainingMs, totalMs, className }: CountdownRingProps) {
  const base = useRef({ at: Date.now(), remainingMs });
  const [, setTick] = useState(0);

  if (base.current.remainingMs !== remainingMs) base.current = { at: Date.now(), remainingMs };

  useEffect(() => {
    const id = setInterval(() => setTick((n) => n + 1), 250);
    return () => clearInterval(id);
  }, []);

  const left = Math.max(0, base.current.remainingMs - (Date.now() - base.current.at));
  const frac = totalMs > 0 ? Math.min(1, left / totalMs) : 0;
  const secs = Math.ceil(left / 1000);

  return (
    <div
      className={["dn-ring", className].filter(Boolean).join(" ")}
      role="timer"
      aria-label={vi.dn2.secondsLeft(secs)}
    >
      <svg viewBox="0 0 140 140" width="140" height="140" aria-hidden="true" className="dn-ring-svg">
        <circle cx="70" cy="70" r={R} fill="none" stroke="var(--surface-2)" strokeWidth="8" />
        <circle
          cx="70"
          cy="70"
          r={R}
          fill="none"
          stroke="var(--accent)"
          strokeWidth="8"
          strokeLinecap="round"
          strokeDasharray={C}
          strokeDashoffset={C * (1 - frac)}
        />
      </svg>
      <div className="dn-ring-label">
        <span className="dn-num dn-ring-num">{secs}</span>
        <span className="dn-ring-cap">{vi.dn2.seconds}</span>
      </div>
    </div>
  );
}
