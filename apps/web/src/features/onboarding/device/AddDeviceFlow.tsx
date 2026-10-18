import { useNavigate, useSearch } from "@tanstack/react-router";
import { ArrowLeft, ServerOff } from "lucide-react";
import { useStore } from "zustand";
import type { DeviceId } from "@devicenet/shared";
import { Banner } from "@/components/dn/Banner";
import { Button } from "@/components/dn/Button";
import { Header } from "@/components/dn/Header";
import { Stepper } from "@/components/dn/Stepper";
import { vi } from "@/i18n/vi";
import { configStore, uiStore } from "@/stores";
import { useHub, useHubStatus } from "@/transport/hooks";
import { StepFind } from "./StepFind";
import { StepName } from "./StepName";
import "./device.css";

export type AddDeviceStep = "find" | "name";

export interface AddDeviceFlowProps {
  step: AddDeviceStep;
  onStep: (step: AddDeviceStep) => void;
  /** Leave the flow (Hủy / back from step 2). */
  onExit: () => void;
  onToHubs: () => void;
  onDone: (firstId: DeviceId | undefined) => void;
}

/** S-11 shell: header + Stepper (step 1 "Chọn hub" auto-done: one hub per site) + the current step. */
export function AddDeviceFlow({ step, onStep, onExit, onToHubs, onDone }: AddDeviceFlowProps) {
  const s = vi.s11;
  const siteId = useStore(uiStore, (st) => st.siteId);
  const firstSite = useStore(configStore, (st) => st.sites[0]?.id ?? null);
  const firstHub = useStore(configStore, (st) => Object.values(st.hubs)[0]);
  const hub = useHub(siteId ?? firstSite) ?? firstHub;
  const status = useHubStatus(hub?.id);
  const offline = !hub || !status.online;
  const hubName = hub?.name ?? "";

  const header = (
    <Header
      left={
        <>
          <button
            type="button"
            className="ibtn"
            aria-label={s.back}
            onClick={() => (step === "name" && !offline ? onStep("find") : onExit())}
          >
            <ArrowLeft className="ic" aria-hidden="true" />
          </button>
          <h1 className="title">{s.title}</h1>
        </>
      }
      right={
        <button type="button" className="txtbtn" onClick={onExit}>
          {vi.common.cancel}
        </button>
      }
    />
  );

  if (offline) {
    return (
      <div className="ph dn-add-page">
        {header}
        <Banner kind="offline" action={s.viewHub} onAction={onToHubs}>
          {s.hubOfflineBanner(hubName)}
        </Banner>
        <div className="body dn-add-body">
          <Stepper steps={[...s.steps]} current={1} />
          <div className="dn-add-center">
            <div className="dn-add-warn">
              <ServerOff className="ic" aria-hidden="true" />
            </div>
            <span className="dn-add-h2">{s.hubOfflineTitle}</span>
            <p className="body-t dn-add-hint" style={{ color: "var(--text-muted)" }}>
              {s.hubOfflineBody}
            </p>
          </div>
        </div>
        <div className="dn-add-foot dn-add-foot-col">
          <Button variant="primary" block onClick={onToHubs}>
            {s.toHub}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="ph dn-add-page">
      {header}
      <div className="dn-add-stepper">
        <Stepper steps={[...s.steps]} current={step === "name" ? 2 : 1} />
      </div>
      {step === "find" ? (
        <StepFind hubId={hub.id} hubName={hub.name} onContinue={() => onStep("name")} />
      ) : (
        <StepName hubId={hub.id} siteId={hub.siteId} onDone={onDone} />
      )}
    </div>
  );
}

/** Route adapter for `/onboarding/device?step=`. */
export function AddDeviceRoute() {
  const navigate = useNavigate();
  const search = useSearch({ strict: false }) as { step?: AddDeviceStep };
  const step: AddDeviceStep = search.step === "name" ? "name" : "find";
  return (
    <AddDeviceFlow
      step={step}
      onStep={(st) => void navigate({ to: "/onboarding/device", search: { step: st } })}
      onExit={() => void navigate({ to: "/home" })}
      onToHubs={() => void navigate({ to: "/me" })}
      onDone={(id) => {
        if (id) uiStore.getState().setHighlight({ deviceId: id, until: Date.now() + 2000 });
        void navigate({ to: "/home" });
      }}
    />
  );
}
