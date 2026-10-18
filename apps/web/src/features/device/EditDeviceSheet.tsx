import { useState } from "react";
import { useStore } from "zustand";
import type { Device } from "@devicenet/shared";
import { Button } from "@/components/dn/Button";
import { Chip } from "@/components/dn/Chip";
import { getIconPickerList } from "@/components/dn/DeviceIcon";
import { Input } from "@/components/dn/Input";
import { Sheet } from "@/components/dn/Sheet";
import { numericSensors } from "@/features/onboarding/device/NameDeviceCard";
import { sheetsVi } from "@/i18n/sheets";
import { formatValue } from "@/lib/format";
import { toastStore, uiStore } from "@/stores";
import { HubTimeoutError } from "@/transport/errors";
import { useConfigWrites, useDeviceState, useRooms, useSendCommand } from "@/transport/hooks";
import "@/features/onboarding/device/device.css";

const ICONS = getIconPickerList();

export interface EditDraft {
  name: string;
  roomId: string | null;
  icon: string;
  primaryProperty?: string;
}

export interface EditDeviceSheetProps {
  device: Device;
  /** Draft restored after the "Room mới" detour through SH-5. */
  draft?: Partial<EditDraft>;
}

/** SH-3 quick edit (S-20 header pencil): name, room, icon, primary property. */
export function EditDeviceSheet({ device, draft: restored }: EditDeviceSheetProps) {
  const s = sheetsVi.sh3;
  const writes = useConfigWrites();
  const sendCommand = useSendCommand();
  const rooms = [...useRooms(device.siteId)].sort((a, b) => a.order - b.order);
  const state = useDeviceState(device.id);
  const sensors = numericSensors(device);
  const [draft, setDraft] = useState<EditDraft>({
    name: device.name,
    roomId: device.roomId,
    icon: device.icon,
    primaryProperty: device.primaryProperty,
    ...restored,
  });
  const [busy, setBusy] = useState(false);
  const trimmed = draft.name.trim();
  const close = () => uiStore.getState().closeSheet();
  const set = (p: Partial<EditDraft>) => setDraft((d) => ({ ...d, ...p }));

  async function save() {
    if (!trimmed || !writes || busy) return;
    setBusy(true);
    try {
      await writes.updateDevicePresentation(device.id, {
        name: trimmed,
        roomId: draft.roomId,
        icon: draft.icon,
        ...(draft.primaryProperty ? { primaryProperty: draft.primaryProperty } : {}),
      });
    } catch {
      toastStore.getState().show({ kind: "error", text: s.saveError });
      setBusy(false);
      return;
    }
    close();
    if (trimmed !== device.name) {
      try {
        await sendCommand(device.hubId, { type: "device.rename", deviceId: device.id, name: trimmed });
      } catch (e) {
        if (e instanceof HubTimeoutError) toastStore.getState().show({ kind: "timeout", text: s.renameTimeout });
      }
    }
  }

  function newRoom() {
    uiStore.getState().openSheet({
      kind: "sh5",
      mode: "newRoom",
      siteId: device.siteId,
      onCreated: (roomId: string) => uiStore.getState().openSheet({ kind: "sh3", deviceId: device.id, draft: { ...draft, roomId } }),
    });
  }

  return (
    <Sheet open title={s.title} onOpenChange={(o) => !o && close()}>
      <form
        className="dn-add-card"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <Input label={s.name} value={draft.name} maxLength={60} onChange={(v) => set({ name: v })} />
        <div className="dn-add-group">
          <span className="lbl">{s.room}</span>
          <div className="dn-add-chips">
            {rooms.map((r) => (
              <Chip key={r.id} selected={draft.roomId === r.id} onClick={() => set({ roomId: draft.roomId === r.id ? null : r.id })}>
                {r.name}
              </Chip>
            ))}
            {writes ? (
              <Chip add onClick={newRoom}>
                {s.newRoom}
              </Chip>
            ) : null}
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
                onClick={() => set({ icon: it.value })}
              >
                {it.icon}
              </button>
            ))}
          </div>
        </div>
        {sensors.length > 0 ? (
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
                    onClick={() => set({ primaryProperty: p.key })}
                  >
                    <span className={on ? "radio radio-on" : "radio"} aria-hidden="true" />
                    <span className="dn-add-main">
                      <span className="lbl">{p.label}</span>
                    </span>
                    {v !== undefined ? <span className="cap dn-num">{formatValue(p, v)}</span> : null}
                  </button>
                );
              })}
            </div>
          </div>
        ) : null}
        <div style={{ display: "flex", gap: "var(--space-2)" }}>
          <Button type="button" variant="secondary" style={{ flex: 1 }} onClick={close}>
            {s.cancel}
          </Button>
          <Button type="submit" variant="primary" style={{ flex: 1 }} loading={busy} disabled={!trimmed || !writes}>
            {s.save}
          </Button>
        </div>
      </form>
    </Sheet>
  );
}

/** Connected SH-3: reads `ui.sheet = { kind: "sh3", deviceId, draft? }`. */
export function EditDeviceSheetHost({ device }: { device: Device }) {
  const sheet = useStore(uiStore, (st) => st.sheet);
  if (sheet?.kind !== "sh3" || sheet.deviceId !== device.id) return null;
  return <EditDeviceSheet key={JSON.stringify(sheet.draft ?? null)} device={device} draft={sheet.draft as Partial<EditDraft> | undefined} />;
}
