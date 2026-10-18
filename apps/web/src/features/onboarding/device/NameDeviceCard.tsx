import type { z } from "zod";
import type { Device, Property, Room as RoomSchema } from "@devicenet/shared";
import { Badge } from "@/components/dn/Badge";
import { Card } from "@/components/dn/Card";
import { Chip } from "@/components/dn/Chip";
import { getIconPickerList } from "@/components/dn/DeviceIcon";
import { Input } from "@/components/dn/Input";
import { vi } from "@/i18n/vi";
import { formatValue } from "@/lib/format";
import { useDeviceState } from "@/transport/hooks";
import "./device.css";

export interface NameDraft {
  name: string;
  roomId: string | null;
  icon: string;
  primaryProperty?: string;
}

export interface NameDeviceCardProps {
  device: Device;
  index: number;
  total: number;
  draft: NameDraft;
  rooms: Room[];
  onChange: (patch: Partial<NameDraft>) => void;
  onNewRoom: () => void;
}

type Room = z.infer<typeof RoomSchema>;
const ICONS = getIconPickerList();

/** Numeric sensors a user can pick as the tile's primary value. */
export function numericSensors(device: Device): Property[] {
  return Object.values(device.properties).filter((p) => p.type === "numeric" && p.category === "sensor");
}

export function NameDeviceCard({ device, index, total, draft, rooms, onChange, onNewRoom }: NameDeviceCardProps) {
  const s = vi.s11;
  const state = useDeviceState(device.id);
  const sensors = numericSensors(device);
  const title = [device.model, device.vendor].filter(Boolean).join(" · ") || device.name;
  return (
    <Card>
      <div className="dn-add-card">
        <div className="dn-add-found-head">
          <span className="dn-add-main">
            <span className="lbl">{title}</span>
            <span className="cap">{s.counter(index + 1, total)}</span>
          </span>
          <Badge tone="new">{s.newBadge}</Badge>
        </div>
        <Input label={s.nameLabel} value={draft.name} maxLength={60} onChange={(v) => onChange({ name: v })} />
        <div className="dn-add-group">
          <span className="lbl">{s.room}</span>
          <div className="dn-add-chips">
            {rooms.map((r) => (
              <Chip
                key={r.id}
                selected={draft.roomId === r.id}
                onClick={() => onChange({ roomId: draft.roomId === r.id ? null : r.id })}
              >
                {r.name}
              </Chip>
            ))}
            <Chip add onClick={onNewRoom}>
              {s.newRoom}
            </Chip>
          </div>
        </div>
        <div className="dn-add-group">
          <span className="lbl">{s.icon}</span>
          <div className="dn-add-icons" role="radiogroup" aria-label={s.iconGroup}>
            {ICONS.map((it) => (
              <button
                key={it.value}
                type="button"
                role="radio"
                aria-checked={draft.icon === it.value}
                aria-label={it.label}
                className="dn-add-icon"
                onClick={() => onChange({ icon: it.value })}
              >
                {it.icon}
              </button>
            ))}
          </div>
        </div>
        {sensors.length > 0 && (
          <div className="dn-add-group">
            <span className="lbl">{s.primary}</span>
            <div role="radiogroup" aria-label={s.primaryGroup}>
              {sensors.map((p) => {
                const on = draft.primaryProperty === p.key;
                const v = state?.values[p.key];
                return (
                  <button
                    key={p.key}
                    type="button"
                    role="radio"
                    aria-checked={on}
                    className="dn-add-prop"
                    onClick={() => onChange({ primaryProperty: p.key })}
                  >
                    <span className={on ? "radio radio-on" : "radio"} aria-hidden="true" />
                    <span className="dn-add-main">
                      <span className="lbl">{p.label}</span>
                      <span className="cap">{p.type === "numeric" && p.unit ? `${p.key} · ${p.unit}` : p.key}</span>
                    </span>
                    {v !== undefined && <span className="lbl dn-num">{formatValue(p, v)}</span>}
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </Card>
  );
}
