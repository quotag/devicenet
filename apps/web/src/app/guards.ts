import { redirect } from "@tanstack/react-router";
import { configStore, sessionStore } from "@/stores";

export interface GuardInput {
  pathname: string;
  mode: "cloud" | "lan";
  status: "booting" | "signedOut" | "bootstrapping" | "ready";
  hasHub: boolean;
}

const isOnboarding = (p: string) => p === "/onboarding" || p.startsWith("/onboarding/");
const isMe = (p: string) => p === "/me" || p.startsWith("/me/") || p === "/settings";

/** Pure redirect decision (null = stay). Plan "Routes" table + FR-F00. */
export function resolveRedirect({ pathname, mode, status, hasHub }: GuardInput): string | null {
  if (mode === "lan") {
    if (pathname === "/login" || isOnboarding(pathname)) return "/home";
    return null;
  }
  if (status === "booting" || status === "bootstrapping") return null;
  if (status === "signedOut") return pathname === "/login" ? null : "/login";
  // ready
  if (pathname === "/login") return hasHub ? "/home" : "/onboarding/hub";
  // Me/Settings stay reachable without a hub (sign-out, "Thêm hub").
  if (!hasHub && !isOnboarding(pathname) && !isMe(pathname)) return "/onboarding/hub";
  return null;
}

export function currentGuardState(): Omit<GuardInput, "pathname"> {
  const s = sessionStore.getState();
  return { mode: s.mode, status: s.status, hasHub: Object.keys(configStore.getState().hubs).length > 0 };
}

/** `beforeLoad` for every route. */
export function guard({ location }: { location: { pathname: string } }): void {
  const to = resolveRedirect({ pathname: location.pathname, ...currentGuardState() });
  if (to && to !== location.pathname) throw redirect({ to });
}
