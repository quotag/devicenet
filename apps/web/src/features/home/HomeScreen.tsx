import { useNavigate } from "@tanstack/react-router";
import { useStore } from "zustand";
import { Button } from "@/components/dn/Button";
import { Header } from "@/components/dn/Header";
import { StatusBanner } from "@/components/dn/StatusBanner";
import { hhmm } from "@/lib/format";
import { useIsDesktop } from "@/lib/useIsDesktop";
import { vi } from "@/i18n/vi";
import { configStore, uiStore } from "@/stores";
import { useConnection, useDevices, useHub, useHubStatus, useRooms } from "@/transport/hooks";
import { DeviceGrid } from "./DeviceGrid";
import { HomeSkeleton, NoDevices, RoomEmpty } from "./HomeEmpty";
import { RoomChips } from "./RoomChips";
import { ArrangeGrid } from "./arrange/ArrangeGrid";
import { ArrangeDone, ArrangeHint, ArrangeLocked, useArrange } from "./arrange/ArrangeBar";

export function HomeScreen() {
  const navigate = useNavigate();
  const desktop = useIsDesktop();
  const sites = useStore(configStore, (s) => s.sites);
  const loaded = useStore(configStore, (s) => s.loaded);
  const uiSite = useStore(uiStore, (s) => s.siteId);
  const filter = useStore(uiStore, (s) => s.filter);
  const site = sites.find((s) => s.id === uiSite) ?? sites[0];
  const siteId = site?.id ?? null;
  const hub = useHub(siteId);
  const hubStatus = useHubStatus(hub?.id);
  const { mqtt, mode } = useConnection();
  const rooms = useRooms(siteId);
  const devices = useDevices(siteId, filter);
  const allDevices = useDevices(siteId, "all");
  const tz = site?.timezone ?? "Asia/Ho_Chi_Minh";
  const loading = !loaded.sites || !loaded.devices;
  const { arranging: arrangingUi, saver, done } = useArrange();
  const canArrange = mode !== "lan" && devices.length > 0;
  const arranging = arrangingUi && canArrange;

  // Priority: hub offline > z2m offline > LAN > reconnecting.
  let banner: { mode: "offline" | "lan" | "reconnecting"; text: string; action?: string } | null = null;
  if (hub && !hubStatus.online) {
    const last = hubStatus.lastSeen ? hhmm(hubStatus.lastSeen, tz) : undefined;
    banner = { mode: "offline", text: vi.banner.hubOffline(hub.name, last), action: vi.home.viewHub };
  } else if (hub && hubStatus.online && hubStatus.z2m === "offline") {
    banner = { mode: "offline", text: vi.banner.z2mOffline(hub.name), action: vi.home.viewHub };
  } else if (mode === "lan") {
    const host = (hubStatus.lanUrl ?? globalThis.location?.hostname ?? "").replace(/^\w+:\/\//, "").replace(/\/.*$/, "");
    banner = { mode: "lan", text: vi.banner.lanMode(host) };
  } else if (mqtt === "reconnecting") {
    banner = { mode: "reconnecting", text: vi.banner.reconnecting };
  }

  const open = (id: string) => void navigate({ to: "/device/$deviceId", params: { deviceId: id } });
  const go = (to: "/onboarding/device" | "/onboarding/hub") => void navigate({ to });
  const room = filter === "all" ? null : rooms.find((r) => r.id === filter);

  return (
    <>
      {desktop ? (
        <div className="dtitle-row">
          <h1 className="dtitle">{site?.name ?? ""}</h1>
          <div className="dtitle-actions">
            {arranging ? (
              <Button variant="secondary" onClick={done}>{vi.arrange.done}</Button>
            ) : (
              <Button variant="secondary" disabled={!canArrange} onClick={() => uiStore.getState().setArranging(true)}>
                {vi.desktop.arrange}
              </Button>
            )}
            <Button variant="primary" disabled={arranging} onClick={() => uiStore.getState().openSheet({ kind: "sh2", ctx: "home" })}>
              {vi.desktop.add}
            </Button>
          </div>
        </div>
      ) : (
        <Header
        siteName={site?.name ?? ""}
        siteLabel={arranging ? vi.arrange.siteDisabled : site ? vi.home.switchSite(site.name) : undefined}
        siteDisabled={!site || arranging}
        right={arranging ? <ArrangeDone onDone={done} /> : undefined}
        onSiteClick={() => uiStore.getState().openSheet({ kind: "sh1" })}
        addLabel={vi.home.add}
        onAdd={() => uiStore.getState().openSheet({ kind: "sh2", ctx: "home" })}
      />
      )}
      {banner && !arranging ? (
        <StatusBanner
          mode={banner.mode}
          text={banner.text}
          action={banner.action}
          onAction={banner.action ? () => void navigate({ to: "/me" }) : undefined}
        />
      ) : null}
      <div className="body" data-testid="home-screen">
        {loading || !siteId ? (
          <HomeSkeleton />
        ) : allDevices.length === 0 ? (
          <NoDevices onAdd={() => go("/onboarding/device")} />
        ) : (
          <>
            {arranging ? <ArrangeHint /> : null}
            <ArrangeLocked locked={arranging}>
              <RoomChips siteId={siteId} canAdd={mode !== "lan" && !arranging} />
            </ArrangeLocked>
            {arranging ? (
              <ArrangeGrid siteId={siteId} filter={filter} timezone={tz} saver={saver} cols={desktop ? 4 : 2} />
            ) : devices.length === 0 && room ? (
              <RoomEmpty room={room.name} onAssign={() => uiStore.getState().openSheet({ kind: "sh3", roomId: room.id })} />
            ) : (
              <DeviceGrid siteId={siteId} filter={filter} timezone={tz} onOpen={open} canArrange={canArrange && !desktop} desktop={desktop} onAddDevice={() => go("/onboarding/device")} />
            )}
          </>
        )}
      </div>
    </>
  );
}
