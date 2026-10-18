import { useMemo, useState } from "react";
import { useStore } from "zustand";
import type { Device, DeviceId } from "@devicenet/shared";
import { Button } from "@/components/dn/Button";
import { getIconPickerList } from "@/components/dn/DeviceIcon";
import { vi } from "@/i18n/vi";
import { foundDevices, primaryKey } from "@/lib/deviceView";
import { configStore, toastStore, uiStore } from "@/stores";
import { useConfigWrites, useRooms, useSendCommand } from "@/transport/hooks";
import { NameDeviceCard, type NameDraft } from "./NameDeviceCard";
import "./device.css";

export interface StepNameProps {
  hubId: string;
  siteId: string;
  /** Called after devices are saved; the first id is highlighted on Home. */
  onDone: (firstId: DeviceId | undefined) => void;
}

const VALID_ICONS = new Set<string>(getIconPickerList().map((i) => i.value));

function initialDraft(d: Device, filter: string): NameDraft {
  return {
    name: d.name || d.model || "",
    roomId: d.roomId ?? (filter !== "all" ? filter : null),
    icon: VALID_ICONS.has(d.icon) ? d.icon : "plug",
    primaryProperty: primaryKey(d),
  };
}

/** Step 3: one card per new device; "Lưu" saves the current one, "Lưu tất cả" saves the rest and leaves. */
export function StepName({ hubId, siteId, onDone }: StepNameProps) {
  const s = vi.s11;
  const writes = useConfigWrites();
  const send = useSendCommand();
  const rooms = useRooms(siteId as never);
  const devices = useStore(configStore, (st) => st.devices);
  // Snapshot: saved devices flip to "active" and would otherwise vanish from the list mid-flow.
  const [ids] = useState<string[]>(() => foundDevices(configStore.getState().devices, hubId));
  const list = useMemo(() => ids.map((id) => devices[id as DeviceId]).filter(Boolean) as Device[], [ids, devices]);
  const [drafts, setDrafts] = useState<Record<string, NameDraft>>(() => {
    const filter = uiStore.getState().filter;
    const all = configStore.getState().devices;
    return Object.fromEntries(ids.map((id) => [id, initialDraft(all[id as DeviceId]!, filter)]));
  });
  const [index, setIndex] = useState(0);
  const [saved, setSaved] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);

  const current = list[Math.min(index, list.length - 1)];
  const draft = current ? drafts[current.id] : undefined;
  const nameOk = (d?: NameDraft) => !!d && d.name.trim().length > 0;

  async function saveOne(d: Device): Promise<boolean> {
    const dr = drafts[d.id]!;
    try {
      await writes?.updateDevicePresentation(d.id, {
        name: dr.name.trim(),
        roomId: dr.roomId,
        icon: dr.icon,
        primaryProperty: dr.primaryProperty,
        status: "active",
      });
      // Z2M friendly_name is cosmetic; never block on it.
      send(d.hubId, { type: "device.rename", deviceId: d.id, name: dr.name.trim() }).catch(() => {});
      return true;
    } catch {
      toastStore.getState().show({ kind: "error", text: s.saveError });
      return false;
    }
  }

  async function onSave() {
    if (!current || busy) return;
    setBusy(true);
    const ok = await saveOne(current);
    setBusy(false);
    if (!ok) return;
    const next = new Set(saved).add(current.id);
    setSaved(next);
    const nextIdx = list.findIndex((d) => !next.has(d.id));
    if (nextIdx === -1) onDone(list[0]?.id);
    else setIndex(nextIdx);
  }

  async function onSaveAll() {
    if (busy) return;
    const todo = list.filter((d) => !saved.has(d.id));
    if (todo.some((d) => !nameOk(drafts[d.id]))) return;
    setBusy(true);
    for (const d of todo) {
      if (!(await saveOne(d))) {
        setBusy(false);
        return;
      }
    }
    setBusy(false);
    onDone(list[0]?.id);
  }

  function patch(id: string, p: Partial<NameDraft>) {
    setDrafts((m) => ({ ...m, [id]: { ...m[id]!, ...p } }));
  }

  function newRoom(id: string) {
    uiStore.getState().openSheet({
      kind: "sh5",
      mode: "newRoom",
      siteId,
      onCreated: (roomId: string) => patch(id, { roomId }),
    });
  }

  if (!current || !draft) {
    return (
      <div className="body dn-add-body">
        <p className="cap">{s.nothingToName}</p>
      </div>
    );
  }

  const allOk = list.filter((d) => !saved.has(d.id)).every((d) => nameOk(drafts[d.id]));
  return (
    <>
      <div className="body dn-add-body">
        <NameDeviceCard
          device={current}
          index={index}
          total={list.length}
          draft={draft}
          rooms={rooms}
          onChange={(p) => patch(current.id, p)}
          onNewRoom={() => newRoom(current.id)}
        />
      </div>
      <div className="dn-add-foot">
        <Button variant="secondary" style={{ flex: 1 }} disabled={busy || !allOk} onClick={onSaveAll}>
          {s.saveAll}
        </Button>
        <Button variant="primary" style={{ flex: 1 }} disabled={busy || !nameOk(draft)} onClick={onSave}>
          {s.save}
        </Button>
      </div>
    </>
  );
}
