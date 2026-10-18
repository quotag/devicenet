import { createStore } from "zustand/vanilla";
import type { TenantId } from "@devicenet/shared";

export type SessionStatus = "booting" | "signedOut" | "bootstrapping" | "ready";
export interface SessionUser {
  uid: string;
  email: string;
  displayName?: string;
  photoUrl?: string;
}
export interface SessionState {
  mode: "cloud" | "lan";
  status: SessionStatus;
  user: SessionUser | null;
  tenantId: TenantId | null;
  idToken: string | null;
  setMode(mode: "cloud" | "lan"): void;
  setStatus(status: SessionStatus): void;
  setUser(user: SessionUser | null): void;
  setTenantId(tenantId: TenantId | null): void;
  setIdToken(idToken: string | null): void;
  reset(): void;
}

export const sessionStore = createStore<SessionState>((set) => ({
  mode: "cloud",
  status: "booting",
  user: null,
  tenantId: null,
  idToken: null,
  setMode: (mode) => set({ mode }),
  setStatus: (status) => set({ status }),
  setUser: (user) => set({ user }),
  setTenantId: (tenantId) => set({ tenantId }),
  setIdToken: (idToken) => set({ idToken }),
  // Sign-out: back to signedOut; mode is preserved.
  reset: () => set({ status: "signedOut", user: null, tenantId: null, idToken: null }),
}));
