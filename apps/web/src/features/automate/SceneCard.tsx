import { Check, Film, Lightbulb, LogOut, Moon, Play, Sun, Wrench, type LucideIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { useStore } from "zustand";
import type { RunId, Scene } from "@devicenet/shared";
import { Badge } from "@/components/dn/Badge";
import { vi } from "@/i18n/vi";
import { connectionStore } from "@/stores/connection";
import { toastStore } from "@/stores/toast";
import { useSendCommand } from "@/transport/hooks";
import { sh6Sheet } from "./editorTarget";
import { useLongPress } from "./useLongPress";

const ICONS: Record<string, LucideIcon> = {
  moon: Moon,
  sun: Sun,
  film: Film,
  "log-out": LogOut,
  lightbulb: Lightbulb,
  plug: Wrench,
};

export const RUN_OK_TICK_MS = 1000;

export interface SceneCardProps {
  scene: Scene;
  /** SH-6 hook point (B21): long-press opens the Sửa / Xóa menu. Receives the sheet descriptor. */
  onLongPress?: (sheet: ReturnType<typeof sh6Sheet>) => void;
}

function ProgressRing({ ratio }: { ratio: number }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="24"
      height="24"
      aria-hidden="true"
      style={{ position: "absolute", top: 12, right: 12, transform: "rotate(-90deg)" }}
    >
      <circle cx="12" cy="12" r="9" fill="none" stroke="var(--surface-2)" strokeWidth="3" />
      <circle
        cx="12"
        cy="12"
        r="9"
        fill="none"
        stroke="var(--accent)"
        strokeWidth="3"
        strokeLinecap="round"
        strokeDasharray="56.5"
        strokeDashoffset={56.5 * (1 - Math.min(1, Math.max(0, ratio)))}
      />
    </svg>
  );
}

/** Tap-to-run card. Tap -> `scene.run`; progress comes from `connection.runs[runId]` (FR-F02). */
export function SceneCard({ scene, onLongPress }: SceneCardProps) {
  const send = useSendCommand();
  const [sending, setSending] = useState(false);
  const [runId, setRunId] = useState<RunId | null>(null);
  const [tickGone, setTickGone] = useState(false);
  const run = useStore(connectionStore, (s) => (runId ? s.runs[runId] : undefined));

  const status = run?.status;
  const running = sending || status === "running";
  const done = run ? run.steps.filter((s) => s.status === "ok" || s.status === "failed" || s.status === "skipped").length : 0;
  const total = run?.total ?? scene.actions.length;
  const failed = status === "partial" || status === "failed";
  const ok = status === "ok" && !tickGone;

  useEffect(() => {
    if (status !== "ok") return;
    setTickGone(false);
    const t = setTimeout(() => setTickGone(true), RUN_OK_TICK_MS);
    return () => clearTimeout(t);
  }, [status, runId]);

  const lp = useLongPress(() => onLongPress?.(sh6Sheet("scene", scene.id)));

  const run_ = async () => {
    if (running) return;
    setSending(true);
    setRunId(null);
    try {
      const ack = await send(scene.hubId, { type: "scene.run", sceneId: scene.id });
      const id = ack.result?.runId;
      if (typeof id === "string") setRunId(id as RunId);
    } catch {
      toastStore.getState().show({ kind: "error", text: vi.automate.runError(scene.name) });
    } finally {
      setSending(false);
    }
  };

  const Icon = (scene.icon && ICONS[scene.icon]) || Play;
  const caption = running
    ? sending && !run
      ? vi.automate.runSending
      : vi.automate.running(done, total)
    : vi.automate.actionsCount(scene.actions.length);

  return (
    <button
      type="button"
      className="card"
      aria-label={running ? vi.automate.runningScene(scene.name) : vi.automate.runScene(scene.name)}
      aria-busy={running ? true : undefined}
      onClick={() => {
        if (lp.shouldIgnoreClick()) return;
        void run_();
      }}
      {...lp.handlers}
      style={{
        height: 120,
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        alignItems: "flex-start",
        textAlign: "left",
        color: "var(--text)",
        cursor: "pointer",
        fontFamily: "inherit",
        position: "relative",
        ...(running ? { background: "var(--on-tint)", borderColor: "var(--accent)" } : null),
      }}
    >
      <Icon className="ic" aria-hidden="true" style={running ? { color: "var(--accent)" } : undefined} />
      <span className="row-main">
        <span className="lbl">{scene.name}</span>
        <span className="cap dn-num">{caption}</span>
      </span>
      {running ? <ProgressRing ratio={total ? done / total : 0} /> : null}
      {ok ? (
        <span
          aria-label={vi.automate.runDone}
          style={{
            position: "absolute",
            top: 12,
            right: 12,
            width: 24,
            height: 24,
            borderRadius: 999,
            background: "var(--success-tint)",
            color: "var(--success)",
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Check className="ic ic-sm" aria-hidden="true" />
        </span>
      ) : null}
      {failed ? (
        <span style={{ position: "absolute", top: 12, right: 12 }}>
          <Badge tone="error">{vi.automate.runFailed}</Badge>
        </span>
      ) : null}
    </button>
  );
}
