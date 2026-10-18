import { useRef } from "react";
import type { PointerEvent } from "react";

export const LONG_PRESS_MS = 500;
const SLOP_PX = 8;

/** Pointer long-press (cancelled by movement > 8 px or release). Returns pointer handlers to spread on the target. */
export function useLongPress(onLongPress: () => void, ms = LONG_PRESS_MS) {
  const t = useRef<ReturnType<typeof setTimeout> | null>(null);
  const start = useRef<{ x: number; y: number } | null>(null);
  const fired = useRef(false);
  const clear = () => {
    if (t.current) clearTimeout(t.current);
    t.current = null;
    start.current = null;
  };
  return {
    /** True if the last press fired a long-press (use to swallow the following click). */
    fired,
    handlers: {
      onPointerDown: (e: PointerEvent) => {
        fired.current = false;
        start.current = { x: e.clientX, y: e.clientY };
        t.current = setTimeout(() => {
          fired.current = true;
          clear();
          onLongPress();
        }, ms);
      },
      onPointerMove: (e: PointerEvent) => {
        const s = start.current;
        if (s && Math.hypot(e.clientX - s.x, e.clientY - s.y) > SLOP_PX) clear();
      },
      onPointerUp: clear,
      onPointerCancel: clear,
      onPointerLeave: clear,
      onContextMenu: (e: { preventDefault(): void }) => {
        if (fired.current) e.preventDefault();
      },
    },
  };
}
