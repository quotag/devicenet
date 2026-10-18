import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { HubId, SiteId, TenantId } from "@devicenet/shared";
import { configStore, resetAll, sessionStore } from "@/stores";
import { AppRouter } from "./providers";
import { resolveRedirect } from "./guards";

const base = { mode: "cloud", status: "ready", hasHub: true } as const;

describe("resolveRedirect", () => {
  it("cloud signed-out → /login", () => {
    expect(resolveRedirect({ ...base, status: "signedOut", pathname: "/home" })).toBe("/login");
    expect(resolveRedirect({ ...base, status: "signedOut", pathname: "/login" })).toBeNull();
  });
  it("cloud ready without hub → /onboarding/hub (Me stays reachable)", () => {
    expect(resolveRedirect({ ...base, hasHub: false, pathname: "/home" })).toBe("/onboarding/hub");
    expect(resolveRedirect({ ...base, hasHub: false, pathname: "/onboarding/device" })).toBeNull();
    expect(resolveRedirect({ ...base, hasHub: false, pathname: "/me" })).toBeNull();
  });
  it("signed-in user leaves /login", () => {
    expect(resolveRedirect({ ...base, pathname: "/login" })).toBe("/home");
    expect(resolveRedirect({ ...base, hasHub: false, pathname: "/login" })).toBe("/onboarding/hub");
  });
  it("LAN: no /login, no onboarding, no hub requirement", () => {
    const lan = { ...base, mode: "lan" } as const;
    expect(resolveRedirect({ ...lan, pathname: "/login" })).toBe("/home");
    expect(resolveRedirect({ ...lan, pathname: "/onboarding/hub" })).toBe("/home");
    expect(resolveRedirect({ ...lan, pathname: "/onboarding/device" })).toBe("/home");
    expect(resolveRedirect({ ...lan, hasHub: false, pathname: "/home" })).toBeNull();
  });
});

describe("router", () => {
  beforeEach(() => resetAll());
  afterEach(cleanup);

  it("signed-out cloud user lands on S-00", async () => {
    sessionStore.getState().setStatus("signedOut");
    render(<AppRouter initialPath="/home" />);
    expect(await screen.findByRole("button", { name: "Tiếp tục với Google" })).toBeInTheDocument();
  });

  it("ready cloud user without hub is sent to onboarding", async () => {
    sessionStore.setState({ status: "ready", tenantId: "tenant_01HZZZZZZZZZZZZZZZZZZZZZZZ" as TenantId });
    configStore.getState().setLoaded("hubs");
    render(<AppRouter initialPath="/home" />);
    expect(await screen.findByRole("heading", { name: "Thêm hub" })).toBeInTheDocument();
  });

  it("LAN user on /login lands on /home", async () => {
    sessionStore.setState({ mode: "lan", status: "ready" });
    render(<AppRouter initialPath="/login" />);
    expect(await screen.findByTestId("home-screen")).toBeInTheDocument();
  });

  it("tab bar switches to Automate stub (S02-Trong empty state)", async () => {
    sessionStore.setState({ mode: "lan", status: "ready" });
    render(<AppRouter initialPath="/home" />);
    await screen.findByTestId("home-screen");
    await act(async () => screen.getByRole("button", { name: "Automate" }).click());
    await waitFor(() => expect(screen.getByText("Chưa có scene nào")).toBeInTheDocument());
  });

  it("Me tab shows hub online state", async () => {
    sessionStore.setState({ mode: "lan", status: "ready" });
    configStore.getState().setHubs({
      ["hub_01HZZZZZZZZZZZZZZZZZZZZZZZ" as HubId]: {
        id: "hub_01HZZZZZZZZZZZZZZZZZZZZZZZ",
        name: "Hub Nhà",
        siteId: "site_01HZZZZZZZZZZZZZZZZZZZZZZZ" as SiteId,
        online: true,
      } as never,
    });
    render(<AppRouter initialPath="/me" />);
    expect(await screen.findByText("Hub Nhà")).toBeInTheDocument();
    expect(screen.getByText("online")).toBeInTheDocument();
  });
});
