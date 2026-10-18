import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { useStore } from "zustand";
import { sessionStore } from "@/stores/session";
import { createTransport, type CreateTransportOptions, type Transport } from "./index";

const TransportContext = createContext<Transport | null>(null);

export interface TransportProviderProps {
  children: ReactNode;
  /** Use this instance (tests / fakes) instead of creating one from the session. */
  transport?: Transport | null;
  /** Passed to `createTransport` when the provider builds the instance itself. */
  options?: CreateTransportOptions;
}

/**
 * Holds the session's Transport. Without an injected `transport`, it is created once the session is
 * `ready` with a tenant, disposed on tenant/mode change, sign-out or unmount; ID-token refreshes go to
 * `setPassword` without reconnecting.
 */
export function TransportProvider({ children, transport, options }: TransportProviderProps) {
  const injected = transport !== undefined;
  const status = useStore(sessionStore, (s) => s.status);
  const mode = useStore(sessionStore, (s) => s.mode);
  const tenantId = useStore(sessionStore, (s) => s.tenantId);
  const uid = useStore(sessionStore, (s) => s.user?.uid);
  const idToken = useStore(sessionStore, (s) => s.idToken);
  const [own, setOwn] = useState<Transport | null>(null);

  useEffect(() => {
    if (injected || status !== "ready" || !tenantId) return;
    let cancelled = false;
    let created: Transport | null = null;
    const token = sessionStore.getState().idToken;
    createTransport(mode, { tenantId, uid, idToken: token }, options).then(
      (t) => {
        if (cancelled) void t.dispose();
        else {
          created = t;
          setOwn(t);
        }
      },
      (e: unknown) => console.error("[transport] create failed", e),
    );
    return () => {
      cancelled = true;
      setOwn(null);
      if (created) void created.dispose();
    };
    // options are read once per session; idToken changes are forwarded below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [injected, status, mode, tenantId, uid]);

  useEffect(() => {
    if (own && idToken) own.setPassword(idToken);
  }, [own, idToken]);

  return <TransportContext.Provider value={injected ? transport : own}>{children}</TransportContext.Provider>;
}

/** The current Transport, or `null` before the session is ready. */
export function useTransport(): Transport | null {
  return useContext(TransportContext);
}
