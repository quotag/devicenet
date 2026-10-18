import { useEffect } from "react";
import { useStore } from "zustand";
import { CircleAlert, RefreshCw } from "lucide-react";
import { toastStore } from "@/stores/toast";
import "./ds2.css";

export const TOAST_MS = 4000;
export const TOAST_ACTION_MS = 8000;

/** Toast host: shows `toastStore.current` (one at a time), auto-hides 4 s / 8 s with action (FR-F14). */
export function Toast() {
  const current = useStore(toastStore, (s) => s.current);

  useEffect(() => {
    if (!current) return;
    const id = setTimeout(() => toastStore.getState().dismiss(), current.action ? TOAST_ACTION_MS : TOAST_MS);
    return () => clearTimeout(id);
  }, [current]);

  return (
    <div role="status" aria-live="polite" className="dn-toast-region">
      {current ? (
        <div className="dn-toast" data-kind={current.kind}>
          {current.kind === "update" ? (
            <RefreshCw className="ic" aria-hidden="true" />
          ) : (
            <CircleAlert className="ic dn-toast-err" aria-hidden="true" />
          )}
          <span className="dn-toast-text">{current.text}</span>
          {current.action ? (
            <button
              type="button"
              className="dn-toast-action"
              onClick={() => {
                current.action?.run();
                toastStore.getState().dismiss();
              }}
            >
              {current.action.label}
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
