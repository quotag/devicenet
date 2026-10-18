import { Outlet, useRouterState } from "@tanstack/react-router";
import { useIsDesktop } from "@/lib/useIsDesktop";
import { DesktopShell } from "./DesktopShell";

/** Root: at >= 900 px every route except /login sits in the sidebar shell; below, routes render unchanged. */
export function RootLayout() {
  const desktop = useIsDesktop();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  if (desktop && pathname !== "/login") {
    return (
      <DesktopShell>
        <Outlet />
      </DesktopShell>
    );
  }
  return <Outlet />;
}
