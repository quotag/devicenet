import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Sheet } from "@/components/dn/Sheet";
import { configStore, resetAll, sessionStore } from "@/stores";
import { AppRouter } from "./providers";

function mockViewport(desktop: boolean) {
  window.matchMedia = ((q: string) => ({
    matches: desktop && q.includes("min-width: 900px"),
    media: q,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  })) as unknown as typeof window.matchMedia;
}

describe("desktop >= 900", () => {
  beforeEach(() => {
    resetAll();
    sessionStore.setState({ mode: "lan", status: "ready" });
  });
  afterEach(() => {
    cleanup();
    // @ts-expect-error reset jsdom default (no matchMedia)
    delete window.matchMedia;
    vi.restoreAllMocks();
  });

  it("renders the sidebar shell instead of the tab bar", async () => {
    mockViewport(true);
    render(<AppRouter initialPath="/home" />);
    expect(await screen.findByTestId("desktop-shell")).toBeInTheDocument();
    const home = screen.getByRole("button", { name: "Home" });
    expect(home).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("button", { name: "+ Thêm" })).toBeInTheDocument();
    await act(async () => screen.getByRole("button", { name: "Automate" }).click());
    await waitFor(() => expect(screen.getByRole("button", { name: "Automate" })).toHaveAttribute("aria-current", "page"));
  });

  it("keeps the mobile tab bar below 900", async () => {
    mockViewport(false);
    render(<AppRouter initialPath="/home" />);
    await screen.findByTestId("home-screen");
    expect(screen.queryByTestId("desktop-shell")).toBeNull();
    expect(screen.getByRole("navigation")).toBeInTheDocument();
  });

  it("disables automate tab when in onboarding", async () => {
    mockViewport(true);
    configStore.setState((s) => ({ ...s, loaded: { ...s.loaded, hubs: true } }));
    sessionStore.setState({ mode: "cloud", status: "ready" });
    render(<AppRouter initialPath="/onboarding/hub" />);
    expect(await screen.findByTestId("desktop-shell")).toBeInTheDocument();
    const automate = screen.getByRole("button", { name: "Automate" });
    expect(automate).toBeDisabled();
    expect(automate).toHaveAttribute("aria-disabled", "true");
  });

  it("sheet can render as a centred dialog", () => {
    render(
      <Sheet open asDialog title="Đổi site" onOpenChange={() => undefined}>
        x
      </Sheet>,
    );
    const dlg = screen.getByRole("dialog");
    expect(dlg).toHaveClass("dn-sheet-dialog");
    expect(dlg.querySelector(".dn-sheet-handle")).toBeNull();
  });
});
