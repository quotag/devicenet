import { Plus } from "lucide-react";
import { useStore } from "zustand";
import { vi } from "@/i18n/vi";
import type { DeviceId, RoomId, SiteId } from "@devicenet/shared";
import { configStore } from "@/stores";
import { useDevices, useRooms } from "@/transport/hooks";
import { HomeTile } from "./HomeTile";
import { PressToArrange } from "./arrange/ArrangeBar";

export interface DeviceGridProps {
  siteId: SiteId;
  filter: "all" | RoomId;
  timezone: string;
  onOpen: (id: DeviceId) => void;
  /** Long-press a tile enters arrange mode (B22). */
  canArrange?: boolean;
  /** Desktop >= 900 (D-Home): 4 columns, no padding, dashed "Thêm thiết bị" cell last. */
  desktop?: boolean;
  onAddDevice?: () => void;
}

export function DeviceGrid({ siteId, filter, timezone, onOpen, canArrange = false, desktop = false, onAddDevice }: DeviceGridProps) {
  const devices = useDevices(siteId, filter);
  const rooms = useRooms(siteId);
  const layout = useStore(configStore, (s) => s.layouts[siteId]);
  const tiles = layout?.filters[filter]?.tiles ?? {};
  const roomName = (id: string | null) => rooms.find((r) => r.id === id)?.name ?? null;
  return (
    <div
      className={desktop ? "dgrid" : undefined}
      style={desktop ? undefined : { display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 16, padding: "12px 16px 16px" }}
    >
      {devices.map((d) => (
        <PressToArrange key={d.id} enabled={canArrange}>
        <HomeTile
          deviceId={d.id}
          timezone={timezone}
          w={tiles[d.id]?.w === 2 ? 2 : 1}
          showRoom={filter === "all" ? roomName(d.roomId) : null}
          onOpen={onOpen}
        />
        </PressToArrange>
      ))}
      {desktop && onAddDevice ? (
        <button type="button" className="dgrid-add" onClick={onAddDevice}>
          <Plus className="ic" aria-hidden="true" />
          <span className="cap">{vi.desktop.addDevice}</span>
        </button>
      ) : null}
    </div>
  );
}
