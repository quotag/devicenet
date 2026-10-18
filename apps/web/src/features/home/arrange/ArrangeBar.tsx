import { useEffect, useRef } from "react";
import type { ReactNode } from "react";
import { useStore } from "zustand";
import type { Layout } from "@devicenet/shared";
import { vi } from "@/i18n/vi";
import { sessionStore, uiStore } from "@/stores";
import { saveLayout } from "@/transport/writes";
import { createLayoutSaver, type LayoutSaver } from "./layoutSaver";
import { useLongPress } from "./useLongPress";

/** "Xong" text button replacing "+" in the header while arranging. */
export function ArrangeDone({ onDone }: { onDone: () => void }) {
  return (
    <button type="button" className="txtbtn" onClick={onDone}>
      {vi.arrange.done}
    </button>
  );
}

/** Hint line under the header (`S01-SapXep`). */
export function ArrangeHint() {
  return (
    <p className="cap" style={{ padding: "12px 16px 0" }}>
      {vi.arrange.hint}
    </p>
  );
}

/** Room chips while arranging: dimmed (.45) and locked — filter cannot change. */
export function ArrangeLocked({ locked, children }: { locked: boolean; children: ReactNode }) {
  if (!locked) return <>{children}</>;
  return (
    <div style={{ opacity: 0.45, pointerEvents: "none" }} aria-disabled="true" inert>
      {children}
    </div>
  );
}

/** Long-press a Home tile → arrange mode. Swallows the click that follows the long-press. */
export function PressToArrange({ enabled, children }: { enabled: boolean; children: ReactNode }) {
  const { handlers, fired } = useLongPress(() => uiStore.getState().setArranging(true));
  if (!enabled) return <>{children}</>;
  return (
    <div
      style={{ display: "contents" }}
      {...handlers}
      onClickCapture={(e) => {
        if (fired.current) {
          fired.current = false;
          e.stopPropagation();
          e.preventDefault();
        }
      }}
    >
      {children}
    </div>
  );
}

/** Arrange-mode state for HomeScreen: saver (cloud only), `done()` flushes and leaves; leaving Home also exits. */
export function useArrange(): { arranging: boolean; saver: LayoutSaver; done: () => void } {
  const arranging = useStore(uiStore, (s) => s.arranging);
  const ref = useRef<LayoutSaver | null>(null);
  if (!ref.current) {
    ref.current = createLayoutSaver(async (layout: Layout) => {
      const { tenantId, mode } = sessionStore.getState();
      if (tenantId && mode === "cloud") await saveLayout(tenantId, layout);
    });
  }
  const saver = ref.current;
  useEffect(
    () => () => {
      void saver.flush();
      uiStore.getState().setArranging(false);
    },
    [saver],
  );
  const done = () => {
    void saver.flush();
    uiStore.getState().setArranging(false);
  };
  return { arranging, saver, done };
}
