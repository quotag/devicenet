import { createRootRoute, lazyRouteComponent, createRoute, createRouter, redirect, createMemoryHistory } from "@tanstack/react-router";
import { LoginScreen } from "@/features/auth/LoginScreen";
import { HomeScreen } from "@/features/home/HomeScreen";
import { setCurrentTarget } from "@/features/automate/editor/editorNav";
import { setEditorOpener } from "@/features/automate/editorTarget";
import { guard } from "./guards";
import { TabLayout } from "./TabLayout";
import { RootLayout } from "./RootLayout";

const rootRoute = createRootRoute({ component: RootLayout, beforeLoad: guard });

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  beforeLoad: () => {
    throw redirect({ to: "/home" });
  },
});
const loginRoute = createRoute({ getParentRoute: () => rootRoute, path: "/login", component: LoginScreen });

const tabLayoutRoute = createRoute({ getParentRoute: () => rootRoute, id: "tabs", component: TabLayout });
const homeRoute = createRoute({ getParentRoute: () => tabLayoutRoute, path: "/home", component: HomeScreen });
const automateRoute = createRoute({ getParentRoute: () => tabLayoutRoute, path: "/automate", component: lazyRouteComponent(() => import("@/features/automate/AutomateScreen"), "AutomateScreen") });
const editorRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/automate/editor",
  component: lazyRouteComponent(() => import("@/features/automate/editor/RuleEditorRoute")),
});
const meRoute = createRoute({ getParentRoute: () => tabLayoutRoute, path: "/me", component: lazyRouteComponent(() => import("@/features/me/MeScreen"), "MeScreen") });

// TODO(B12/B13/B15): replace Placeholders with the real flows.
const hubOnboardingRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/onboarding/hub",
  component: lazyRouteComponent(() => import("@/features/onboarding/hub/AddHubFlow"), "AddHubFlow"),
});
const deviceOnboardingRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/onboarding/device",
  validateSearch: (s: Record<string, unknown>): { step?: "find" | "name" } => ({
    step: s.step === "name" ? "name" : s.step === "find" ? "find" : undefined,
  }),
  component: lazyRouteComponent(() => import("@/features/onboarding/device/AddDeviceFlow"), "AddDeviceRoute"),
});
const deviceRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/device/$deviceId",
  component: lazyRouteComponent(() => import("@/features/device/DeviceDetailRoute"), "DeviceDetailRoute"),
});

const hubDetailRoute = createRoute({ getParentRoute: () => rootRoute, path: "/me/hub/$hubId", component: lazyRouteComponent(() => import("@/features/me/HubDetailRoute"), "HubDetailRoute") });
const historyRoute = createRoute({ getParentRoute: () => rootRoute, path: "/me/history", component: lazyRouteComponent(() => import("@/features/me/HistoryScreen"), "HistoryScreen") });
const settingsRoute = createRoute({ getParentRoute: () => rootRoute, path: "/settings", component: lazyRouteComponent(() => import("@/features/me/SettingsScreen"), "SettingsScreen") });

export const routeTree = rootRoute.addChildren([
  indexRoute,
  loginRoute,
  tabLayoutRoute.addChildren([homeRoute, automateRoute, meRoute]),
  editorRoute,
  hubOnboardingRoute,
  deviceOnboardingRoute,
  deviceRoute,
  hubDetailRoute,
  historyRoute,
  settingsRoute,
]);

export function createAppRouter(initialPath?: string) {
  const router = createRouter({
    routeTree,
    ...(initialPath ? { history: createMemoryHistory({ initialEntries: [initialPath] }) } : {}),
  });
  // S-02 cards / suggestions / "+" open S-30 through this hook (B17 → B19).
  setEditorOpener((target) => {
    setCurrentTarget(target);
    void router.navigate({ to: "/automate/editor" });
  });
  return router;
}

declare module "@tanstack/react-router" {
  interface Register {
    router: ReturnType<typeof createAppRouter>;
  }
}
