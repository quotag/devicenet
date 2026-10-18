import { useNavigate } from "@tanstack/react-router";
import { useStore } from "zustand";
import { ChevronRight, LayoutGrid, Plug, Rows3, Router } from "lucide-react";
import type { ReactNode } from "react";
import { Sheet } from "@/components/dn/Sheet";
import { vi } from "@/i18n/vi";
import { configStore, uiStore } from "@/stores";
import { useConnection, useDevices } from "@/transport/hooks";

function Item({
  icon,
  label,
  cap,
  onClick,
  disabled,
  chevron = true,
}: {
  icon: ReactNode;
  label: string;
  cap: string;
  onClick?: () => void;
  disabled?: boolean;
  chevron?: boolean;
}) {
  return (
    <button
      type="button"
      className="row"
      disabled={disabled}
      onClick={onClick}
      style={{
        border: 0,
        background: "transparent",
        color: "var(--text)",
        padding: "8px 0",
        cursor: "pointer",
        textAlign: "left",
        width: "100%",
        opacity: disabled ? 0.5 : 1,
      }}
    >
      {icon}
      <span className="row-main">
        <span className="lbl">{label}</span>
        <span className="cap">{cap}</span>
      </span>
      {chevron ? <ChevronRight className="ic" aria-hidden="true" style={{ color: "var(--text-muted)" }} /> : null}
    </button>
  );
}

/** SH-2 (Home variant). "Sắp xếp tile" stays disabled until B22 passes `canArrange`. */
export function AddMenuSheet({
  siteName,
  siteId,
  go,
  canArrange = false,
}: {
  siteName: string;
  siteId?: string;
  go: (to: "/onboarding/device" | "/onboarding/hub") => void;
  canArrange?: boolean;
}) {
  const ui = uiStore.getState();
  const close = () => ui.closeSheet();
  return (
    <Sheet open onOpenChange={(o) => !o && close()} title={vi.sh2.title}>
      <div style={{ display: "flex", flexDirection: "column" }}>
        <Item
          icon={<Plug className="ic" aria-hidden="true" />}
          label={vi.sh2.addDevice}
          cap={vi.sh2.addDeviceCap}
          onClick={() => {
            close();
            go("/onboarding/device");
          }}
        />
        <Item
          icon={<LayoutGrid className="ic" aria-hidden="true" />}
          label={vi.sh2.addRoom}
          cap={vi.sh2.addRoomCap(siteName)}
          onClick={() => ui.openSheet({ kind: "sh5", mode: "newRoom", siteId })}
        />
        <Item
          icon={<Router className="ic" aria-hidden="true" />}
          label={vi.sh2.addHub}
          cap={vi.sh2.addHubCap}
          onClick={() => {
            close();
            go("/onboarding/hub");
          }}
        />
        <Item
          icon={<Rows3 className="ic" aria-hidden="true" />}
          label={vi.sh2.arrange}
          cap={vi.sh2.arrangeCap}
          chevron={false}
          disabled={!canArrange}
          onClick={() => {
            close();
            ui.setArranging(true);
          }}
        />
      </div>
    </Sheet>
  );
}

/** Connected SH-2 for SheetHost (`ui.sheet.kind === "sh2"`, ctx home). */
export function AddMenuSheetHost() {
  const navigate = useNavigate();
  const sites = useStore(configStore, (s) => s.sites);
  const uiSite = useStore(uiStore, (s) => s.siteId);
  const site = sites.find((s) => s.id === uiSite) ?? sites[0];
  const filter = useStore(uiStore, (s) => s.filter);
  const { mode } = useConnection();
  const devices = useDevices(site?.id, filter);
  const canArrange = mode !== "lan" && devices.length > 0;
  return (
    <AddMenuSheet
      siteName={site?.name ?? ""}
      siteId={site?.id}
      go={(to) => void navigate({ to })}
      canArrange={canArrange}
    />
  );
}
