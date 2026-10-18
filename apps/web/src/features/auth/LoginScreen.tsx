import { useState } from "react";
import { Button } from "@/components/dn/Button";
import { vi } from "@/i18n/vi";
import { toastStore } from "@/stores";
import { signIn } from "./session";

/** S-00 per `design/Main.dc.html`: logo block, title, tagline, Google button (loading), terms. */
export function LoginScreen() {
  const [loading, setLoading] = useState(false);
  async function onClick() {
    setLoading(true);
    try {
      await signIn();
    } catch (e) {
      console.warn("[auth] sign-in failed", e);
      toastStore.getState().show({ kind: "error", text: vi.s00.error });
    } finally {
      setLoading(false);
    }
  }
  return (
    <main style={{ display: "flex", flexDirection: "column", alignItems: "center", height: "100dvh", padding: "0 16px", background: "var(--bg)" }}>
      <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 16, width: "100%" }}>
        <div style={{ width: 72, height: 72, borderRadius: 20, background: "var(--on-tint)", color: "var(--accent)", display: "flex", alignItems: "center", justifyContent: "center" }}>
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M4 14h16a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2v-4a2 2 0 0 1 2-2z" />
            <path d="M6 18h.01" />
            <path d="M10 18h.01" />
            <path d="M15 10v4" />
            <path d="M17.84 7.17a4 4 0 0 0-5.66 0" />
            <path d="M20.66 4.34a8 8 0 0 0-11.31 0" />
          </svg>
        </div>
        <h1 style={{ margin: 0, fontSize: 32, lineHeight: "38px", fontWeight: 600 }}>DeviceNet</h1>
        <p className="body-t" style={{ color: "var(--text-muted)", textAlign: "center" }}>
          {vi.s00.tagline}
        </p>
      </div>
      <div style={{ width: "100%", display: "flex", flexDirection: "column", gap: 16, paddingBottom: 48, alignItems: "center" }}>
        <Button variant="primary" block loading={loading} onClick={onClick} style={{ width: "100%" }}>
          {vi.s00.google}
        </Button>
        <p className="cap" style={{ textAlign: "center", maxWidth: 300 }}>
          {vi.s00.termsPrefix} <a href="#" style={{ color: "var(--accent)" }}>{vi.s00.terms}</a> {vi.s00.and}{" "}
          <a href="#" style={{ color: "var(--accent)" }}>{vi.s00.privacy}</a>.
        </p>
      </div>
    </main>
  );
}
