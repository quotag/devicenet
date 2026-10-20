import { useState } from "react";
import { Copy } from "lucide-react";
import { Button } from "@/components/dn/Button";
import { SegmentedTabs } from "@/components/dn/SegmentedTabs";
import { vi } from "@/i18n/vi";

const t = vi.s10;

export function StepInstall({ onNext }: { onNext: () => void }) {
  const [os, setOs] = useState(0);
  const [copied, setCopied] = useState(false);

  const baseUrl =
    import.meta.env.VITE_AGENT_BASE_URL ||
    (typeof window !== "undefined" && window.location.origin
      ? window.location.origin
      : "https://[YOUR-DOMAIN]");
  const apiUrl = import.meta.env.VITE_API_URL;
  const commands = t.installCmd(baseUrl, apiUrl);

  const copy = () => {
    void navigator.clipboard?.writeText(commands[os]!).then(
      () => {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      },
      () => undefined,
    );
  };
  return (
    <>
      <div className="body" style={{ gap: 20, padding: "16px 16px 0" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <h2 className="title" style={{ fontSize: 20 }}>{t.installTitle}</h2>
          <p className="body-t" style={{ color: "var(--text-muted)" }}>{t.installBody}</p>
        </div>
        <SegmentedTabs items={[...t.osTabs]} value={os} onChange={setOs} />
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <div className="code-box" style={{ position: "relative", paddingRight: 48 }}>
            {commands[os]}
            <button
              type="button"
              className="ibtn"
              aria-label={t.copy}
              onClick={copy}
              style={{ position: "absolute", right: 2, top: 2, width: 40, height: 40 }}
            >
              <Copy className="ic" aria-hidden="true" />
            </button>
          </div>
          <p className="cap">{t.installNote[os]}</p>
          <span className="cap" role="status">{copied ? t.copied : ""}</span>
        </div>
        <div className="card" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <span className="lbl">{t.afterInstallTitle}</span>
          <p className="body-t">
            {t.afterInstallBody}{" "}
            <a href={t.setupUrl} target="_blank" rel="noreferrer" className="dn-num" style={{ textDecoration: "underline", color: "var(--accent)" }}>
              {t.setupUrl}
            </a>
            {t.afterInstallBody2}
          </p>
        </div>
      </div>
      <div style={{ padding: "16px 16px 40px", display: "flex", flexDirection: "column", gap: 8 }}>
        <Button variant="primary" block onClick={onNext}>{t.installed}</Button>
        {/* TODO-OQ OQ-B12-1: guide destination undefined, disabled */}
        <Button variant="ghost" block disabled>{t.guide}</Button>
      </div>
    </>
  );
}
