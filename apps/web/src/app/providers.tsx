import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider } from "@tanstack/react-router";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useStore } from "zustand";
import { Toast } from "@/components/dn/Toast";
import { startCloudSession, startLanSession } from "@/features/auth/session";
import { vi } from "@/i18n/vi";
import { initTheme } from "@/lib/theme";
import { configStore, sessionStore } from "@/stores";
import { TransportProvider } from "@/transport/TransportProvider";
import { createAppRouter } from "./router";

/** Boots the session: cloud → Firebase ID-token listener; LAN → `/api/config`. */
export function useSessionBoot(mode: "cloud" | "lan"): void {
  useEffect(() => {
    let off: (() => void) | undefined;
    let cancelled = false;
    if (mode === "lan") {
      startLanSession().catch((e: unknown) => console.error("[session] LAN boot failed", e));
    } else {
      startCloudSession().then(
        (u) => (cancelled ? u() : (off = u)),
        (e: unknown) => {
          console.error("[session] cloud boot failed", e);
          sessionStore.getState().setStatus("signedOut");
        },
      );
    }
    return () => {
      cancelled = true;
      off?.();
    };
  }, [mode]);
}

/** Theme + QueryClient + Transport + Toast around `children`. */
export function Providers({ children }: { children: ReactNode }) {
  const [qc] = useState(() => new QueryClient({ defaultOptions: { queries: { retry: false } } }));
  useEffect(() => initTheme(), []);
  return (
    <QueryClientProvider client={qc}>
      <TransportProvider>
        {children}
        <Toast />
      </TransportProvider>
    </QueryClientProvider>
  );
}

function Splash() {
  return (
    <div role="status" className="cap" style={{ display: "grid", placeItems: "center", height: "100dvh" }}>
      {vi.s00.booting}
    </div>
  );
}

/** Holds the router until the session (and, in cloud, the hub list) is known so guards never flash a wrong screen. */
export function AppRouter({ initialPath }: { initialPath?: string }) {
  const router = useMemo(() => createAppRouter(initialPath), [initialPath]);
  const status = useStore(sessionStore, (s) => s.status);
  const mode = useStore(sessionStore, (s) => s.mode);
  const hubsLoaded = useStore(configStore, (s) => !!s.loaded.hubs);
  const hubCount = useStore(configStore, (s) => Object.keys(s.hubs).length);
  const waiting = status === "booting" || (mode === "cloud" && status === "ready" && !hubsLoaded);

  useEffect(() => {
    if (!waiting) void router.invalidate();
  }, [router, waiting, status, mode, hubCount]);

  if (waiting) return <Splash />;
  return <RouterProvider router={router} />;
}

export function App({ mode, initialPath }: { mode: "cloud" | "lan"; initialPath?: string }) {
  useSessionBoot(mode);
  return (
    <Providers>
      <AppRouter initialPath={initialPath} />
    </Providers>
  );
}
