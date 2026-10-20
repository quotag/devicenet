import { useCallback, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Banner } from "@/components/dn/Banner";
import { Button } from "@/components/dn/Button";
import { CODE_LENGTH, CodeInput } from "@/components/dn/CodeInput";
import { QrScan } from "./QrScan";
import { vi } from "@/i18n/vi";

const t = vi.s10;

export type ClaimFn = (body: { code: string; siteId: string; name: string }) => Promise<string>;

/** POST /v1/hubs/claim → hubId. Throws ApiError (400 bad code / 409 other tenant). */
export const claimHub: ClaimFn = async (body) => {
  // Lazy: keeps env parsing out of module load (same convention as auth/session.ts).
  const { ApiError, getApi } = await import("@/lib/api");
  const { data } = await getApi().POST("/v1/hubs/claim", { body });
  if (!data) throw new ApiError(500, "unknown", "empty response");
  return data.hubId;
};

export interface StepCodeProps {
  siteId: string;
  siteName: string;
  claim?: ClaimFn;
  onClaimed: (hubId: string) => void;
}

export function StepCode({ siteId, siteName, claim = claimHub, onClaimed }: StepCodeProps) {
  const [code, setCode] = useState("");
  const [scanning, setScanning] = useState(false);
  const onScanned = useCallback((c: string) => {
    setScanning(false);
    setCode(c);
  }, []);
  const m = useMutation({
    mutationFn: (c: string) => claim({ code: c, siteId, name: t.defaultHubName(siteName) }),
    onSuccess: (id) => onClaimed(id),
  });
  const status = m.error ? ((m.error as { status?: number }).status ?? 0) : null;
  const bad = status === 400;
  const other = status === 409;
  const generic = m.isError && !bad && !other;
  const ready = code.length === CODE_LENGTH;
  const submit = () => {
    if (ready && !m.isPending) m.mutate(code);
  };
  const edit = (v: string) => {
    if (m.isError) m.reset();
    setCode(v);
  };

  return (
    <>
      {bad && <Banner kind="error">{t.badBanner}</Banner>}
      {other && <Banner kind="error">{t.otherAccountBanner}</Banner>}
      {generic && <Banner kind="error">{t.genericError}</Banner>}
      <div className="body" style={{ gap: 20, padding: "16px 16px 0" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <h2 className="title" style={{ fontSize: 20 }}>{t.codeTitle}</h2>
          <p className="body-t" style={{ color: "var(--text-muted)" }}>
            {t.codeBody}{" "}
            <a href={t.setupUrl} target="_blank" rel="noreferrer" className="dn-num" style={{ textDecoration: "underline", color: "var(--accent)" }}>
              {t.setupUrl}
            </a>{" "}
            {t.codeBody2}
          </p>
        </div>
        <CodeInput value={code} onChange={edit} invalid={bad} disabled={m.isPending} autoFocus />
        {bad ? (
          <>
            <p className="cap" style={{ color: "var(--danger)" }} role="alert">{t.badNote}</p>
            <div className="card" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <span className="lbl">{t.newCodeTitle}</span>
              <p className="body-t">
                {t.newCodeBody}{" "}
                <a href={t.setupUrl} target="_blank" rel="noreferrer" className="dn-num" style={{ textDecoration: "underline", color: "var(--accent)" }}>
                  {t.setupUrl}
                </a>{" "}
                {t.newCodeBody2}
              </p>
              <Button
                variant="secondary"
                block
                onClick={() => {
                  m.reset();
                  setCode("");
                }}
              >
                {t.haveNewCode}
              </Button>
            </div>
          </>
        ) : (
          <>
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <div style={{ flex: 1, height: 1, background: "var(--border)" }} />
              <span className="cap">{t.or}</span>
              <div style={{ flex: 1, height: 1, background: "var(--border)" }} />
            </div>
            {scanning ? (
              <QrScan onCode={onScanned} onClose={() => setScanning(false)} />
            ) : (
              <Button variant="secondary" block disabled={m.isPending} onClick={() => setScanning(true)}>{t.scanQr}</Button>
            )}
            <p className="cap">{t.codeNote}</p>
          </>
        )}
        {(bad || other) && (
          <p className="cap">
            {t.otherAccount} <span className="dn-num">{t.resetCmd}</span> {t.otherAccount2}
          </p>
        )}
      </div>
      <div style={{ padding: "16px 16px 40px" }}>
        <Button variant="primary" block disabled={!ready} loading={m.isPending} onClick={submit}>
          {bad ? t.retry : t.connect}
        </Button>
      </div>
    </>
  );
}
