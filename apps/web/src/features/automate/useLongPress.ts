import { useCallback, useRef } from "react";

export const LONG_PRESS_MS = 500;

/** Pointer long-press (500 ms). The click that follows a fired long-press is swallowed via `shouldIgnoreClick()`. */
export function useLongPress(onLong: () => void, ms = LONG_PRESS_MS) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fired = useRef(false);
  const clear = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  }, []);
  return {
    handlers: {
      onPointerDown: () => {
        fired.current = false;
        clear();
        timer.current = setTimeout(() => {
          fired.current = true;
          onLong();
        }, ms);
      },
      onPointerUp: clear,
      onPointerLeave: clear,
      onPointerCancel: clear,
      onContextMenu: (e: { preventDefault(): void }) => {
        e.preventDefault();
        clear();
        fired.current = true;
        onLong();
      },
    },
    shouldIgnoreClick: () => {
      const f = fired.current;
      fired.current = false;
      return f;
    },
  };
}
