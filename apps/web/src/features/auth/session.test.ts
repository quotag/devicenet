import { beforeEach, describe, expect, it, vi } from "vitest";
import { configStore, resetAll, sessionStore, uiStore } from "@/stores";
import { applyAuthUser, signOut, startLanSession, type AuthUser } from "./session";

const TENANT = "tenant_01HZZZZZZZZZZZZZZZZZZZZZZZ";

function user(opts: { claimAfterRefresh: string | undefined; claimInitial?: string }): AuthUser & { refreshed: number } {
  let refreshed = 0;
  return {
    uid: "u1",
    email: "a@b.c",
    get refreshed() {
      return refreshed;
    },
    getIdToken: async (force) => {
      if (force) refreshed++;
      return force ? "tok2" : "tok1";
    },
    getTenantClaim: async () => (refreshed > 0 ? opts.claimAfterRefresh : opts.claimInitial),
  };
}

beforeEach(() => resetAll());

describe("applyAuthUser", () => {
  it("bootstraps once when tenant claim is missing, then refreshes the token", async () => {
    let tokenDuringBootstrap: string | null = null;
    const bootstrap = vi.fn(async () => {
      tokenDuringBootstrap = sessionStore.getState().idToken;
    });
    const u = user({ claimAfterRefresh: TENANT });
    await applyAuthUser(u, { bootstrap });
    expect(bootstrap).toHaveBeenCalledTimes(1);
    expect(tokenDuringBootstrap).toBe("tok1");
    expect(u.refreshed).toBe(1);
    const s = sessionStore.getState();
    expect(s.status).toBe("ready");
    expect(s.tenantId).toBe(TENANT);
    expect(s.idToken).toBe("tok2");
  });

  it("does not bootstrap when the claim exists", async () => {
    const bootstrap = vi.fn(async () => undefined);
    await applyAuthUser(user({ claimInitial: TENANT, claimAfterRefresh: TENANT }), { bootstrap });
    expect(bootstrap).not.toHaveBeenCalled();
    expect(sessionStore.getState().status).toBe("ready");
    expect(sessionStore.getState().idToken).toBe("tok1");
  });

  it("null user → signedOut", async () => {
    await applyAuthUser(null, { bootstrap: vi.fn() });
    expect(sessionStore.getState().status).toBe("signedOut");
  });
});

describe("signOut", () => {
  it("signs out, resets stores and clears the Firestore cache", async () => {
    sessionStore.setState({ status: "ready", tenantId: TENANT as never, idToken: "x" });
    uiStore.getState().openSheet({ kind: "sh2", ctx: "home" });
    configStore.getState().setLoaded("hubs");
    const authSignOut = vi.fn(async () => undefined);
    const clearFirestore = vi.fn(async () => undefined);
    await signOut({ authSignOut, clearFirestore });
    expect(authSignOut).toHaveBeenCalled();
    expect(clearFirestore).toHaveBeenCalled();
    expect(sessionStore.getState()).toMatchObject({ status: "signedOut", tenantId: null, idToken: null });
    expect(uiStore.getState().sheet).toBeNull();
    expect(configStore.getState().loaded.hubs).toBeUndefined();
  });
});

describe("startLanSession", () => {
  it("takes the tenant from /api/config, no login", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ tenantId: TENANT }), { status: 200 }));
    await startLanSession(fetchImpl as unknown as typeof fetch);
    expect(sessionStore.getState()).toMatchObject({ mode: "lan", status: "ready", tenantId: TENANT });
  });
});
