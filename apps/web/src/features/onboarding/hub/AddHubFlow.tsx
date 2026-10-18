import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useStore } from "zustand";
import { ArrowLeft } from "lucide-react";
import { Header } from "@/components/dn/Header";
import { Stepper } from "@/components/dn/Stepper";
import { vi } from "@/i18n/vi";
import { configStore, uiStore } from "@/stores";
import { StepCode, type ClaimFn } from "./StepCode";
import { StepConnect } from "./StepConnect";
import { StepInstall } from "./StepInstall";

const t = vi.s10;

export type HubStep = "install" | "code" | "connect";
const ORDER: HubStep[] = ["install", "code", "connect"];

export function AddHubFlow({ claim }: { claim?: ClaimFn }) {
  const navigate = useNavigate();
  const [step, setStep] = useState<HubStep>("install");
  const [hubId, setHubId] = useState<string | null>(null);
  const sites = useStore(configStore, (s) => s.sites);
  const uiSite = useStore(uiStore, (s) => s.siteId);
  const site = sites.find((s) => s.id === uiSite) ?? sites[0];
  const idx = ORDER.indexOf(step);

  const back = () => {
    if (step === "code") setStep("install");
    else if (step === "install") void navigate({ to: "/me" });
  };

  return (
    <div className="ph" style={{ display: "flex", flexDirection: "column", minHeight: "100dvh" }}>
      <Header
        hideAdd
        left={
          <>
            {step !== "connect" && (
              <button type="button" className="ibtn" aria-label={t.back} onClick={back}>
                <ArrowLeft className="ic" aria-hidden="true" />
              </button>
            )}
            <h1 className="title">{t.title}</h1>
          </>
        }
      />
      <div style={{ padding: "16px 16px 0" }}>
        <Stepper steps={[...t.steps]} current={idx} />
      </div>
      {step === "install" && <StepInstall onNext={() => setStep("code")} />}
      {step === "code" && (
        <StepCode
          siteId={site?.id ?? ""}
          siteName={site?.name ?? ""}
          claim={claim}
          onClaimed={(id) => {
            setHubId(id);
            setStep("connect");
          }}
        />
      )}
      {step === "connect" && hubId && (
        <StepConnect
          hubId={hubId}
          initialSiteId={site?.id ?? ""}
          onDone={(next) => void navigate({ to: next === "device" ? "/onboarding/device" : "/home" })}
        />
      )}
    </div>
  );
}
