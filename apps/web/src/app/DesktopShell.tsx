import type { ReactNode } from "react";
import { useNavigate, useRouterState } from "@tanstack/react-router";
import { ChevronDown, House, Router, User, Zap } from "lucide-react";
import { useStore } from "zustand";
import { vi } from "@/i18n/vi";
import { configStore, sessionStore, uiStore } from "@/stores";
import { useDevices, useHub, useHubStatus } from "@/transport/hooks";
import { SheetHost } from "./SheetHost";
import { tabOf } from "./TabLayout";
import "./desktop.css";

const NAV = [
  { id: "home", icon: House },
  { id: "automate", icon: Zap },
  { id: "me", icon: User },
] as const;

/** Wide screens (grid / two-column editor) own their padding; every other screen sits in a 640 column. */
export function isWideRoute(pathname: string): boolean {
  return pathname.startsWith("/home") || pathname.startsWith("/automate/editor");
}

/** Sidebar shell >= 900 px replacing the TabBar: logo, site switcher, nav (aria-current + red dot), hub card. */
export function DesktopShell({ children }: { children: ReactNode }) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const navigate = useNavigate();
  const sites = useStore(configStore, (s) => s.sites);
  const uiSite = useStore(uiStore, (s) => s.siteId);
  const site = sites.find((s) => s.id === uiSite) ?? sites[0];
  const hub = useHub(site?.id);
  const hubStatus = useHubStatus(hub?.id);
  const deviceCount = useDevices(site?.id, "all").length;
  const ruleBroken = useStore(configStore, (s) => Object.values(s.rules).some((r) => Boolean(r.brokenReason) || r.lastResult === "broken"));
  const hubOffline = useStore(configStore, (s) => Object.values(s.hubs).some((h) => !h.online));
  const mode = useStore(sessionStore, (s) => s.mode);
  const hasHub = Object.keys(useStore(configStore, (s) => s.hubs)).length > 0;
  const isAddingHub = pathname.startsWith("/onboarding") || (mode === "cloud" && !hasHub);
  const current = tabOf(pathname);
  const wide = isWideRoute(pathname);
  const d = vi.desktop;

  return (
    <div className="dshell" data-testid="desktop-shell">
      <aside className="dside">
        <div className="dside-brand">
          <span className="dside-logo">
            <Router className="ic" aria-hidden="true" />
          </span>
          <span className="lbl" style={{ fontSize: 17 }}>{d.brand}</span>
        </div>
        <button
          type="button"
          className="dside-site"
          disabled={!site}
          aria-label={site ? vi.home.switchSite(site.name) : undefined}
          onClick={() => uiStore.getState().openSheet({ kind: "sh1" })}
        >
          {site?.name ?? ""}
          <ChevronDown className="ic" aria-hidden="true" />
        </button>
        <nav className="dside-nav" aria-label={vi.dn2.nav}>
          {NAV.map(({ id, icon: Icon }) => {
            const isDisabled = id === "automate" && isAddingHub;
            return (
              <button
                key={id}
                type="button"
                className="dside-item"
                aria-current={id === current ? "page" : undefined}
                aria-disabled={isDisabled ? "true" : undefined}
                disabled={isDisabled}
                title={isDisabled ? "Cần hoàn tất thêm hub trước khi dùng Automation" : undefined}
                onClick={() => !isDisabled && void navigate({ to: `/${id}` })}
              >
                <Icon className="ic" aria-hidden="true" />
                {vi.dn2.tabs[id]}
                {id === "automate" && ruleBroken ? <span className="dside-dot" role="img" aria-label={d.ruleBroken} data-testid="side-dot-automate" /> : null}
                {id === "me" && hubOffline ? <span className="dside-dot" data-testid="side-dot-me" /> : null}
              </button>
            );
          })}
        </nav>
        {hub ? (
          <div className="dside-hub">
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span className="dot" style={{ background: hubStatus.online ? "var(--success)" : "var(--danger)" }} />
              <span className="lbl">{d.hubCard(hub.name)}</span>
            </div>
            <p className="cap dn-num" style={{ margin: "4px 0 0" }}>{d.hubMeta(hubStatus.online, hubStatus.agentVersion, deviceCount)}</p>
          </div>
        ) : null}
      </aside>
      <main className={wide ? "dmain dmain-wide" : "dmain"}>
        {wide ? children : <div className="dcol">{children}</div>}
      </main>
      <SheetHost />
    </div>
  );
}
