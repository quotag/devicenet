import { useEffect, useState } from "react";
import { Button } from "@/components/dn/Button";
import { CODE_LENGTH, sanitizeCode } from "@/components/dn/CodeInput";
import { vi } from "@/i18n/vi";

const t = vi.s10;

/** Extract the claim code from `devicenet://claim?code=XXXX` (or a bare code); null when invalid. */
export function parseClaimQr(text: string): string | null {
  const s = text.trim();
  let raw = s;
  if (/^devicenet:\/\//i.test(s)) {
    const m = /[?&]code=([^&#]*)/i.exec(s);
    if (!m) return null;
    try {
      raw = decodeURIComponent(m[1]!);
    } catch {
      return null;
    }
  }
  const code = sanitizeCode(raw);
  return code.length === CODE_LENGTH && code === raw.toUpperCase() ? code : null;
}

export interface QrScanProps {
  onCode: (code: string) => void;
  onClose: () => void;
}

/** Camera QR scanner. `@zxing/browser` is loaded lazily on mount (kept out of the main bundle). */
export function QrScan({ onCode, onClose }: QrScanProps) {
  const [error, setError] = useState(false);
  const [video, setVideo] = useState<HTMLVideoElement | null>(null);

  useEffect(() => {
    if (!video) return;
    let stop: (() => void) | undefined;
    let cancelled = false;
    (async () => {
      try {
        const { BrowserQRCodeReader } = await import("@zxing/browser");
        const reader = new BrowserQRCodeReader();
        const controls = await reader.decodeFromVideoDevice(undefined, video, (result) => {
          const code = result ? parseClaimQr(result.getText()) : null;
          if (code && !cancelled) {
            cancelled = true;
            controls.stop();
            onCode(code);
          }
        });
        if (cancelled) controls.stop();
        else stop = () => controls.stop();
      } catch {
        if (!cancelled) setError(true);
      }
    })();
    return () => {
      cancelled = true;
      stop?.();
    };
  }, [video, onCode]);

  return (
    <div className="card" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {error ? (
        <p className="cap" style={{ color: "var(--danger)" }} role="alert">{t.scanError}</p>
      ) : (
        <video ref={setVideo} muted playsInline style={{ width: "100%", borderRadius: 12, background: "#000" }} />
      )}
      <Button variant="secondary" block onClick={onClose}>{t.scanClose}</Button>
    </div>
  );
}
