import { useEffect, useRef, useState } from "react";
import { useStore } from "zustand";
import type { Device, HubId } from "@devicenet/shared";
import { Button } from "@/components/dn/Button";
import { Spinner } from "@/components/dn/Button";
import { CountdownRing } from "@/components/dn/CountdownRing";
import { vi } from "@/i18n/vi";
import { foundDevices } from "@/lib/deviceView";
import { configStore, connectionStore, toastStore } from "@/stores";
import { useConnection, usePairing, useSendCommand } from "@/transport/hooks";
import { FoundDeviceCard } from "./FoundDeviceCard";
import "./device.css";

const PAIRING_SECONDS = 120;

export interface StepFindProps {
  hubId: HubId;
  hubName: string;
  onContinue: () => void;
}

type Phase = "starting" | "running" | "expired";

/** Step 2: opens permit-join (unless the retained pairing is already active), shows the countdown + found devices. */
export function StepFind({ hubId, hubName, onContinue }: StepFindProps) {
  const s = vi.s11;
  const send = useSendCommand();
  const sendRef = useRef(send);
  sendRef.current = send;
  const { mqtt } = useConnection();
  const ready = mqtt === "online";
  const pairing = usePairing(hubId);
  const devices = useStore(configStore, (st) => st.devices);
  const found = foundDevices(devices, hubId).map((id) => devices[id as keyof typeof devices]).filter(Boolean) as Device[];

  const [phase, setPhase] = useState<Phase>(pairing.active ? "running" : "starting");
  const [attempt, setAttempt] = useState(0);
  // Spec §9: a retained active pairing is adopted, not restarted.
  const adopt = useRef(attempt === 0 && pairing.active);

  useEffect(() => {
    if (!ready) return;
    if (adopt.current && connectionStore.getState().pairing[hubId]?.active) return;
    let cancelled = false;
    sendRef
      .current(hubId, { type: "pairing.start", seconds: PAIRING_SECONDS })
      .catch(() => {
        if (cancelled) return;
        toastStore.getState().show({ kind: "error", text: s.pairingError });
        setPhase("expired");
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, hubId, attempt]);

  // Leaving the step (Hủy, Continue, back, unmount) closes permit-join.
  useEffect(
    () => () => {
      adopt.current = false;
      sendRef.current(hubId, { type: "pairing.stop" }).catch(() => {});
    },
    [hubId],
  );

  useEffect(() => {
    if (pairing.active) setPhase("running");
    else if (phase === "running") setPhase("expired");
  }, [pairing.active, phase]);

  function retry() {
    adopt.current = false;
    setPhase("starting");
    setAttempt((n) => n + 1);
  }

  const expired = phase === "expired";
  const empty = found.length === 0;

  return (
    <>
      <div className="body dn-add-body">
        {expired && empty ? (
          <>
            <div className="dn-add-center">
              <CountdownRing remainingMs={0} totalMs={PAIRING_SECONDS * 1000} />
              <span className="dn-add-h2">{s.noneTitle}</span>
              <p className="body-t dn-add-hint" style={{ color: "var(--text-muted)" }}>
                {s.noneBody(PAIRING_SECONDS)}
              </p>
            </div>
            <div className="card dn-add-group">
              <span className="lbl">{s.tipsTitle}</span>
              <ul className="body-t dn-add-tips">
                {s.tips.map((t) => (
                  <li key={t}>{t}</li>
                ))}
              </ul>
            </div>
          </>
        ) : (
          <>
            <div className="dn-add-hub">
              <span className="dot" style={{ background: expired ? "var(--text-muted)" : "var(--success)" }} />
              <span className="cap">{expired ? s.hubLineClosed(hubName) : s.hubLine(hubName)}</span>
            </div>
            {!expired && (
              <div className="dn-add-center">
                <CountdownRing remainingMs={pairing.remainingMs} totalMs={PAIRING_SECONDS * 1000} />
                <p className="body-t dn-add-hint">{s.holdButton}</p>
              </div>
            )}
            <div className="dn-add-list">
              {!empty && <span className="cap">{s.found(found.length)}</span>}
              {found.map((d) => (
                <FoundDeviceCard key={d.id} device={d} onName={onContinue} />
              ))}
              {!expired && (
                <div className="dn-add-searching">
                  <Spinner />
                  <span className="cap">{s.searchingMore}</span>
                </div>
              )}
            </div>
          </>
        )}
      </div>
      <div className={`dn-add-foot dn-add-foot-col`}>
        {expired && (
          <Button variant={empty ? "primary" : "secondary"} block onClick={retry}>
            {s.retry}
          </Button>
        )}
        {!empty && (
          <Button variant="primary" block onClick={onContinue}>
            {s.continueWith(found.length)}
          </Button>
        )}
        {!expired && empty && (
          <Button variant="primary" block disabled>
            {s.continueWith(0)}
          </Button>
        )}
      </div>
    </>
  );
}
