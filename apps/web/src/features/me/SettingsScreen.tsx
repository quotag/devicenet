import { useNavigate } from "@tanstack/react-router";
import { ArrowLeft, LogOut, Wifi } from "lucide-react";
import { useStore } from "zustand";
import { Badge } from "@/components/dn/Badge";
import { Button } from "@/components/dn/Button";
import { SegmentedTabs } from "@/components/dn/SegmentedTabs";
import { signOut } from "@/features/auth/session";
import { getTheme, setTheme, type Theme } from "@/lib/theme";
import { vi } from "@/i18n/vi";
import { configStore, sessionStore, toastStore, uiStore } from "@/stores";
import { useConfigWrites, useHubStatus } from "@/transport/hooks";
import type { MemberPrefs } from "@/transport/writes";
import { setTempUnitLocal, useTempUnit } from "./prefs";

const s = vi.s40;
const THEMES: Theme[] = ["light", "dark", "system"];

export function appVersion(): string {
  return typeof __APP_VERSION__ === "string" ? __APP_VERSION__ : "0.0.0";
}

/** S-40 Cai dat: display prefs (local + members/{uid}.prefs), LAN open, push "Sap co", sign out, versions. No account deletion (D-16), no auto-LAN toggle (D-17). */
export function SettingsScreen({ signOutFn = signOut }: { signOutFn?: () => Promise<void> | void }) {
  const navigate = useNavigate();
  const user = useStore(sessionStore, (x) => x.user);
  const mode = useStore(sessionStore, (x) => x.mode);
  const uid = user?.uid;
  const hub = useStore(configStore, (x) => Object.values(x.hubs)[0]);
  const status = useHubStatus(hub?.id);
  const writes = useConfigWrites();
  const unit = useTempUnit();
  const theme = useStore(uiStore, (x) => x.theme);
  const themeIdx = Math.max(0, THEMES.indexOf(theme === "system" && getTheme() !== "system" ? getTheme() : theme));
  const lanUrl = status.lanUrl;

  const persist = (p: MemberPrefs) => {
    if (!uid || !writes?.setPrefs) return;
    writes.setPrefs(uid, p).catch(() => toastStore.getState().show({ kind: "error", text: s.prefsError }));
  };

  return (
    <>
      <header className="hdr">
        <div className="hdr-l">
          <button className="ibtn" type="button" aria-label={s.back} onClick={() => void navigate({ to: "/me" })}>
            <ArrowLeft className="ic" aria-hidden="true" />
          </button>
          <h1 className="title">{s.title}</h1>
        </div>
        <div className="hdr-r" />
      </header>
      <div className="body" style={{ paddingBottom: 24, overflowY: "auto" }}>
        <p className="sect-h" style={{ marginTop: 16 }}>{s.display}</p>
        <div className="list">
          <div className="row">
            <span className="row-main"><span className="lbl">{s.language}</span></span>
            <span className="cap">{s.languageValue}</span>
          </div>
          <div className="row">
            <span className="row-main"><span className="lbl">{s.tempUnit}</span></span>
            <SegmentedTabs
              label={s.tempUnit}
              items={[...s.units]}
              value={unit === "F" ? 1 : 0}
              onChange={(i) => {
                const u = i === 1 ? "F" : "C";
                setTempUnitLocal(u);
                persist({ tempUnit: u });
              }}
              className="w-[120px]"
            />
          </div>
          <div className="row">
            <span className="row-main"><span className="lbl">{s.theme}</span></span>
            <SegmentedTabs
              label={s.theme}
              items={[...s.themes]}
              value={themeIdx}
              onChange={(i) => {
                const t = THEMES[i] ?? "system";
                setTheme(t);
                uiStore.getState().setTheme(t);
                persist({ theme: t });
              }}
              className="w-[200px]"
            />
          </div>
        </div>

        <p className="sect-h">{s.connection}</p>
        <div className="list">
          <div className="row">
            <Wifi className="ic" aria-hidden="true" style={{ color: "var(--lan)" }} />
            <span className="row-main">
              <span className="lbl">{s.lanMode}</span>
              <span className="cap">{s.lanBody}</span>
            </span>
          </div>
          {lanUrl && hub ? (
            <div className="row">
              <span className="row-main">
                <span className="lbl dn-num">{lanUrl}</span>
                <span className="cap">{s.lanNote(hub.name)}</span>
              </span>
              <Button variant="secondary" onClick={() => window.open(lanUrl, "_blank")}>{s.open}</Button>
            </div>
          ) : null}
        </div>

        <p className="sect-h">{s.notifications}</p>
        <div className="list" style={{ opacity: 0.6 }}>
          <div className="row">
            <span className="row-main">
              <span className="lbl">{s.push}</span>
              <span className="cap">{s.phase2}</span>
            </span>
            <Badge tone="neutral" plain>{s.soon}</Badge>
          </div>
        </div>

        <p className="sect-h">{s.account}</p>
        <div className="list">
          {user ? (
            <div className="row">
              <span className="row-main">
                <span className="lbl">{user.displayName || user.email}</span>
                <span className="cap">{user.email} · Google</span>
              </span>
            </div>
          ) : null}
          {mode === "cloud" ? (
            <button type="button" className="row" style={{ width: "100%", color: "var(--accent)" }} onClick={() => void signOutFn()}>
              <LogOut className="ic" aria-hidden="true" />
              <span className="lbl">{s.signOut}</span>
            </button>
          ) : null}
        </div>

        <p className="sect-h">{s.about}</p>
        <div className="list">
          <div className="kv"><span className="cap">{s.version}</span><span className="lbl dn-num">{s.appName(appVersion())}</span></div>
          <div className="kv">
            <span className="cap">{s.hubAgent}</span>
            <span className="lbl dn-num">
              {status.agentVersion ? `v${status.agentVersion}` : "-"}
              {hub?.z2mVersion ? ` · Zigbee2MQTT ${hub.z2mVersion}` : ""}
            </span>
          </div>
        </div>
      </div>
    </>
  );
}
