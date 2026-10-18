import { useMemo, useState } from "react";
import { useStore } from "zustand";
import { referencedIds, type Device } from "@devicenet/shared";
import { ConfirmDialog, WillBreakList } from "@/features/me/sheets/ConfirmDialog";
import { Checkbox } from "@/components/ui/checkbox";
import { sheetsVi } from "@/i18n/sheets";
import { configStore, toastStore, uiStore } from "@/stores";
import { vi } from "@/i18n/vi";
import { useDeviceState, useSendCommand } from "@/transport/hooks";

/** Names of rules and scenes that reference `deviceId` (they turn "Sẽ lỗi" after removal). */
export function referencingNames(
  deviceId: string,
  rules: Record<string, Parameters<typeof referencedIds>[0] & { name: string }>,
  scenes: Record<string, Parameters<typeof referencedIds>[0] & { name: string }>,
): string[] {
  const out: string[] = [];
  for (const d of [...Object.values(rules), ...Object.values(scenes)]) if (referencedIds(d).devices.has(deviceId)) out.push(d.name);
  return out;
}

export interface DeleteDeviceSheetProps {
  device: Device;
  /** Called after the hub acked `device.remove` (S-20 navigates Home). */
  onDeleted: () => void;
}

/** SH-4, two steps: list of "Sẽ lỗi" refs + checkbox, then final confirm → `device.remove {force: !online}`. */
export function DeleteDeviceSheet({ device, onDeleted }: DeleteDeviceSheetProps) {
  const s = sheetsVi.sh4;
  const rules = useStore(configStore, (st) => st.rules);
  const scenes = useStore(configStore, (st) => st.scenes);
  const state = useDeviceState(device.id);
  const sendCommand = useSendCommand();
  const names = useMemo(() => referencingNames(device.id, rules as never, scenes as never), [device.id, rules, scenes]);
  const [step, setStep] = useState<1 | 2>(1);
  const [ack, setAck] = useState(false);
  const [busy, setBusy] = useState(false);
  const close = () => uiStore.getState().closeSheet();
  const online = state?.online !== false;

  async function remove() {
    if (busy) return;
    setBusy(true);
    try {
      const r = await sendCommand(device.hubId, { type: "device.remove", deviceId: device.id, force: !online });
      if (!r.ok) throw new Error("rejected");
      close();
      onDeleted();
    } catch {
      toastStore.getState().show({ kind: "error", text: vi.toast.deleteError });
      setBusy(false);
    }
  }

  const checkbox = (
    <label style={{ display: "flex", alignItems: "flex-start", gap: "var(--space-2)", cursor: "pointer" }}>
      <Checkbox checked={ack} onCheckedChange={(v) => setAck(v === true)} />
      <span className="cap">{s.understand}</span>
    </label>
  );

  if (step === 1) {
    return (
      <ConfirmDialog
        title={s.title1(device.name)}
        cancelLabel={s.cancel}
        confirmLabel={s.delete}
        confirmDisabled={!ack}
        onCancel={close}
        onConfirm={() => setStep(2)}
      >
        <p className="cap" style={{ margin: 0 }}>
          {names.length > 0 ? `${s.body1} ${s.refs(names.length)}` : s.body1}
        </p>
        <WillBreakList label={s.willBreak} names={names} />
        {checkbox}
      </ConfirmDialog>
    );
  }
  return (
    <ConfirmDialog
      title={s.title2}
      cancelLabel={s.keep}
      confirmLabel={s.confirm}
      confirmVariant="primary"
      busy={busy}
      onCancel={close}
      onConfirm={() => void remove()}
    >
      <p className="cap" style={{ margin: 0 }}>
        {s.body2}
      </p>
      {checkbox}
    </ConfirmDialog>
  );
}

/** Connected SH-4: reads `ui.sheet = { kind: "sh4", deviceId }`. */
export function DeleteDeviceSheetHost({ device, onDeleted }: DeleteDeviceSheetProps) {
  const sheet = useStore(uiStore, (st) => st.sheet);
  if (sheet?.kind !== "sh4" || sheet.deviceId !== device.id) return null;
  return <DeleteDeviceSheet device={device} onDeleted={onDeleted} />;
}
