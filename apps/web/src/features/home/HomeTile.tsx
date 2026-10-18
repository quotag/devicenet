import { memo } from "react";
import { useStore } from "zustand";
import type { DeviceId, Property, PropertyValue, SiteId } from "@devicenet/shared";
import { DeviceIcon } from "@/components/dn/DeviceIcon";
import { DeviceTile } from "@/components/dn/DeviceTile";
import { formatValue, hhmm } from "@/lib/format";
import { primaryKey, secondarySensors, toggleKey } from "@/lib/deviceView";
import { configStore, connectionStore, uiStore } from "@/stores";
import { useDevice, useDeviceState, useHubStatus, useSetValues } from "@/transport/hooks";

export interface HomeTileProps {
  deviceId: DeviceId;
  siteId?: SiteId;
  timezone: string;
  /** Layout width (2 → 2×1 tile). */
  w?: 1 | 2;
  showRoom?: string | null;
  /** Arrange mode (B22): wiggle + handle, no toggle, body tap does not open. */
  arranging?: boolean;
  onOpen: (id: DeviceId) => void;
}

/** Split "86 W" into value + unit so DeviceTile can style the unit separately. */
function split(prop: Property, v: PropertyValue): { value: string; unit?: string } {
  const full = formatValue(prop, v);
  const unit = prop.type === "numeric" ? prop.unit : undefined;
  return { value: unit && full.endsWith(` ${unit}`) ? full.slice(0, -unit.length - 1) : full, unit };
}

/** Connected tile: reads one device + its state, toggles via setValues (optimistic pending, FR-F01/D-05). */
export const HomeTile = memo(function HomeTile({ deviceId, timezone, w = 1, showRoom, arranging, onOpen }: HomeTileProps) {
  const device = useDevice(deviceId);
  const st = useDeviceState(deviceId);
  const hub = useHubStatus(device?.hubId);
  const setValues = useSetValues();
  const highlighted = useStore(uiStore, (s) => s.highlight?.deviceId === deviceId && s.highlight.until > Date.now());
  // Spec §5: Firestore snapshot served from cache while MQTT is not online → show cached data dimmed.
  const fromCache = useStore(configStore, (s) => s.fromCache);
  const mqttUp = useStore(connectionStore, (s) => s.mqtt === "online");
  const stale = fromCache && !mqttUp;
  if (!device) return null;

  const tk = toggleKey(device);
  const pk = primaryKey(device);
  const offline = !hub.online || st?.online === false;
  const on = tk ? st?.values[tk] === true : false;
  const pending = tk ? (st?.pending.has(tk) ?? false) : false;
  const kind = tk && pk ? "mixed" : tk ? "switch" : "sensor";

  const main = pk && st?.values[pk] !== undefined ? split(device.properties[pk]!, st.values[pk]!) : undefined;
  const extras =
    w === 2
      ? secondarySensors(device, 2).flatMap((p) => (st?.values[p.key] === undefined ? [] : [split(p, st.values[p.key]!)]))
      : undefined;

  return (
    <div
      style={{ ...(w === 2 ? { gridColumn: "span 2" } : null), ...(stale ? { opacity: 0.55 } : null) }}
      data-stale={stale || undefined}
      onClick={(e) => {
        if (arranging || (e.target as HTMLElement).closest("button")) return; // toggle handled separately
        onOpen(deviceId);
      }}
    >
      <DeviceTile
        size={w === 2 ? "2x1" : "1x1"}
        kind={kind}
        name={device.name}
        room={showRoom}
        on={on}
        pending={pending}
        offline={offline}
        arranging={arranging}
        highlight={highlighted}
        value={main?.value}
        unit={main?.unit}
        lastSeen={st?.lastSeen ? hhmm(st.lastSeen, timezone) : undefined}
        extras={extras}
        icon={<DeviceIcon icon={device.icon as never} />}
        onToggle={(next) => {
          if (!tk || offline) return;
          // Rejections (hub offline) are surfaced by banners; the pending-timeout toast is owned by the transport.
          void setValues(deviceId, { [tk]: next }).catch(() => undefined);
        }}
      />
    </div>
  );
});
