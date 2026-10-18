import type { Device } from "@devicenet/shared";
import { Badge } from "@/components/dn/Badge";
import { Button } from "@/components/dn/Button";
import { Card } from "@/components/dn/Card";
import { DeviceIcon } from "@/components/dn/DeviceIcon";
import { vi } from "@/i18n/vi";
import { useDeviceState } from "@/transport/hooks";
import "./device.css";

export interface FoundDeviceCardProps {
  device: Device;
  onName: () => void;
}

/** One newly paired device (`status:"new"`) in the S-11 "Tìm thiết bị" list. */
export function FoundDeviceCard({ device, onName }: FoundDeviceCardProps) {
  const s = vi.s11;
  const state = useDeviceState(device.id);
  const title = device.model ? `${device.model} · ${device.name}` : device.name;
  const props = Object.keys(device.properties).length;
  const sub = [device.vendor, s.propCount(props), state?.lqi !== undefined ? s.lqi(state.lqi) : undefined]
    .filter(Boolean)
    .join(" · ");
  return (
    <Card highlight>
      <div className="dn-add-found" data-testid={`found-${device.id}`}>
        <div className="dn-add-found-head">
          <span className="dn-add-ico">
            <DeviceIcon icon={device.icon as never} />
          </span>
          <span className="dn-add-main">
            <span className="lbl">{title}</span>
            <span className="cap">{sub}</span>
          </span>
          <Badge tone="new">{s.newBadge}</Badge>
        </div>
        <Button variant="secondary" block onClick={onName}>
          {s.nameBtn}
        </Button>
      </div>
    </Card>
  );
}
