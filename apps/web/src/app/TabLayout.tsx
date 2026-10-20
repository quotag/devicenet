import { Outlet, useNavigate, useRouterState } from "@tanstack/react-router";
import { useStore } from "zustand";
import { TabBar, type TabId } from "@/components/dn/TabBar";
import { useIsDesktop } from "@/lib/useIsDesktop";
import { configStore, sessionStore } from "@/stores";
import { SheetHost } from "./SheetHost";

export function tabOf(pathname: string): TabId {
  if (pathname.startsWith("/automate")) return "automate";
  if (pathname.startsWith("/me") || pathname.startsWith("/settings")) return "me";
  return "home";
}

/** Tab screens render their own header (artboards); this adds the bottom TabBar (red dot on Me when a hub is offline). */
export function TabLayout() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const navigate = useNavigate();
  const hubOffline = useStore(configStore, (s) => Object.values(s.hubs).some((h) => !h.online));
  const ruleBroken = useStore(configStore, (s) => Object.values(s.rules).some((r) => Boolean(r.brokenReason) || r.lastResult === "broken"));
  const hasHub = useStore(configStore, (s) => Object.keys(s.hubs).length > 0);
  const mode = useStore(sessionStore, (s) => s.mode);
  const isAutomateDisabled = pathname.startsWith("/onboarding") || (mode === "cloud" && !hasHub);
  const desktop = useIsDesktop();
  if (desktop) return <Outlet />; // sidebar + SheetHost come from DesktopShell (root layout)
  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100dvh", background: "var(--bg)" }}>
      <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
        <Outlet />
      </div>
      <TabBar
        value={tabOf(pathname)}
        dots={{ me: hubOffline, automate: ruleBroken }}
        disabled={{ automate: isAutomateDisabled }}
        onChange={(t) => void navigate({ to: `/${t}` })}
      />
      <SheetHost />
    </div>
  );
}
