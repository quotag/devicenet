/**
 * Session service (FR-F00): maps an auth user to the session store, bootstraps the tenant on first
 * login, and signs out. Firebase is only reached through dynamic imports behind `VITE_MODE !== "lan"`.
 */
import { resetAll, sessionStore } from "@/stores";
import type { TenantId } from "@devicenet/shared";

export interface AuthUser {
  uid: string;
  email: string;
  displayName?: string;
  photoUrl?: string;
  getIdToken(forceRefresh?: boolean): Promise<string>;
  /** Value of the ID-token claim `tenant`, if present. */
  getTenantClaim(): Promise<string | undefined>;
}

export interface SessionDeps {
  /** `POST /v1/tenants/bootstrap {timezone}`. */
  bootstrap(timezone: string, idToken?: string): Promise<void>;
}

export const defaultDeps: SessionDeps = {
  async bootstrap(timezone, idToken) {
    const { getApi } = await import("@/lib/api");
    const headers = idToken ? { Authorization: `Bearer ${idToken}` } : undefined;
    const { error } = await getApi().POST("/v1/tenants/bootstrap", {
      body: { timezone },
      headers,
    });
    if (error) throw new Error("bootstrap failed");
  },
};

function timezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "Asia/Ho_Chi_Minh";
  } catch {
    return "Asia/Ho_Chi_Minh";
  }
}

/** Auth state change → session store. Bootstraps once when the `tenant` claim is missing, then refreshes the token. */
export async function applyAuthUser(user: AuthUser | null, deps: SessionDeps = defaultDeps): Promise<void> {
  const s = sessionStore.getState();
  if (!user) {
    s.setUser(null);
    s.setTenantId(null);
    s.setIdToken(null);
    s.setStatus("signedOut");
    return;
  }
  let token = await user.getIdToken();
  s.setIdToken(token);
  s.setUser({ uid: user.uid, email: user.email, displayName: user.displayName, photoUrl: user.photoUrl });
  let tenant = await user.getTenantClaim();
  if (!tenant) {
    s.setStatus("bootstrapping");
    await deps.bootstrap(timezone(), token);
    token = await user.getIdToken(true);
    s.setIdToken(token);
    tenant = await user.getTenantClaim();
    if (!tenant) throw new Error("tenant claim missing after bootstrap");
  }
  s.setTenantId(tenant as TenantId);
  s.setIdToken(token);
  s.setStatus("ready");
}

let authModule: typeof import("./firebaseAuth") | null = null;

/** Cloud boot: subscribe to Firebase ID-token changes. Returns unsubscribe. */
export async function startCloudSession(deps: SessionDeps = defaultDeps): Promise<() => void> {
  sessionStore.getState().setMode("cloud");
  if (import.meta.env.VITE_MODE === "lan") return () => undefined;
  const { setTokenGetter } = await import("@/lib/api");
  setTokenGetter(() => sessionStore.getState().idToken);
  const mod = await import("./firebaseAuth");
  authModule = mod;
  let seq = 0;
  return mod.watchAuth((u) => {
    const mine = ++seq;
    applyAuthUser(u, deps).catch((e: unknown) => {
      console.error("[session] auth failed", e);
      if (mine === seq) {
        sessionStore.getState().setStatus("signedOut");
        void import("@/stores/toast").then(({ toastStore }) =>
          import("@/i18n/vi").then(({ vi }) => toastStore.getState().show({ kind: "error", text: vi.s00.bootstrapError })),
        );
      }
    });
  });
}

/** LAN boot (no login): tenant comes from `GET /api/config`. */
export async function startLanSession(fetchImpl: typeof fetch = (...a) => fetch(...a)): Promise<void> {
  const s = sessionStore.getState();
  s.setMode("lan");
  const res = await fetchImpl("/api/config");
  if (!res.ok) throw new Error(`GET /api/config ${res.status}`);
  const cfg = (await res.json()) as { tenantId: string };
  s.setUser({ uid: "lan", email: "" });
  s.setTenantId(cfg.tenantId as TenantId);
  s.setStatus("ready");
}

export async function signIn(): Promise<void> {
  if (import.meta.env.VITE_MODE === "lan") return;
  const mod = authModule ?? (await import("./firebaseAuth"));
  authModule = mod;
  await mod.signInWithGoogle();
}

export interface SignOutDeps {
  authSignOut(): Promise<void>;
  clearFirestore(): Promise<void>;
}

async function cloudSignOutDeps(): Promise<SignOutDeps> {
  if (import.meta.env.VITE_MODE === "lan") return { authSignOut: async () => undefined, clearFirestore: async () => undefined };
  const [{ firebaseSignOut }, { resetDb }] = await Promise.all([
    import("./firebaseAuth"),
    import("@/transport/cloud/firestore"),
  ]);
  return { authSignOut: firebaseSignOut, clearFirestore: resetDb };
}

/** Sign out: Firebase signOut, reset all stores (TransportProvider disposes the transport), wipe Firestore cache. */
export async function signOut(deps?: SignOutDeps): Promise<void> {
  const d = deps ?? (await cloudSignOutDeps());
  await d.authSignOut().catch((e: unknown) => console.warn("[session] signOut", e));
  resetAll();
  await d.clearFirestore().catch((e: unknown) => console.warn("[session] clear cache", e));
}
