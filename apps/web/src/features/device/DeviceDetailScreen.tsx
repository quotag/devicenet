import { useCallback, type ReactNode } from "react";
import { useStore } from "zustand";
import { useNavigate } from "@tanstack/react-router";
import { ArrowLeft, Pencil } from "lucide-react";
import type { DeviceId, Property, PropertyValue } from "@devicenet/shared";
import { Banner } from "@/components/dn/Banner";
import { Button } from "@/components/dn/Button";
import { DeviceIcon, type DeviceIconType } from "@/components/dn/DeviceIcon";
import { Switch } from "@/components/dn/Switch";
import { vi } from "@/i18n/vi";
import { formatValue, hhmm, relativeTime } from "@/lib/format";
import { primaryKey, propertyGroups, toggleKey } from "@/lib/deviceView";
import { toastStore } from "@/stores/toast";
import { uiStore } from "@/stores/ui";
import { DeleteDeviceSheetHost } from "./DeleteDeviceSheet";
import { EditDeviceSheetHost } from "./EditDeviceSheet";
import { HubTimeoutError } from "@/transport/errors";
import { useDevice, useDeviceState, useHub, useHubNow, useRooms, useSendCommand, useSetValues, useSites } from "@/transport/hooks";
import { OfflineCard } from "./OfflineCard";
import { PropertyControl, isWritable } from "./PropertyControl";
import { PropertyRow } from "./PropertyRow";
import { TechGroup } from "./TechGroup";

function Group({ title, dim, children }: { title: string; dim?: boolean; children: ReactNode }) {
  return (
    <div style={dim ? { opacity: 0.55 } : undefined}>
      <p className="cap" style={{ margin: "0 0 8px" }}>
        {title}
      </p>
      <div className="list" style={{ margin: 0 }}>
        {children}
      </div>
    </div>
  );
}

export function DeviceDetailScreen({ deviceId }: { deviceId: DeviceId }) {
  const t = vi.s20;
  const navigate = useNavigate();
  const device = useDevice(deviceId);
  const state = useDeviceState(deviceId);
  const hub = useHub(device?.siteId);
  const rooms = useRooms(device?.siteId);
  const site = useSites().find((s) => s.id === device?.siteId);
  const hubNow = useHubNow(hub?.id);
  const setValues = useSetValues();
  const sendCommand = useSendCommand();

  const sheetKind = useStore(uiStore, (s) => s.sheet?.kind);

  const back = useCallback(() => void navigate({ to: "/home" }), [navigate]);

  const ping = useCallback(async () => {
    if (!device) return;
    try {
      const ack = await sendCommand(device.hubId, { type: "device.ping", deviceId: device.id });
      if (!ack.ok) toastStore.getState().show({ kind: "error", text: t.pingFailed });
    } catch (e) {
      toastStore.getState().show(
        e instanceof HubTimeoutError
          ? { kind: "timeout", text: vi.toast.timeout(device.name) }
          : { kind: "error", text: t.pingFailed },
      );
    }
  }, [device, sendCommand, t.pingFailed]);

  const set = useCallback(
    (key: string, value: unknown) => {
      void setValues(deviceId, { [key]: value }).catch(() =>
        toastStore.getState().show({ kind: "error", text: vi.toast.timeout(device?.name ?? "") }),
      );
    },
    [setValues, deviceId, device?.name],
  );

  const header = (title: string) => (
    <header className="hdr">
      <div className="hdr-l">
        <button type="button" className="ibtn" aria-label={t.back} onClick={back}>
          <ArrowLeft className="ic" aria-hidden="true" />
        </button>
        <h1 className="title" style={{ fontSize: 17 }}>
          {title}
        </h1>
      </div>
      <div className="hdr-r">
        <button
          type="button"
          className="ibtn"
          aria-label={t.edit}
          aria-expanded={sheetKind === "sh3"}
          disabled={!device}
          onClick={() => device && uiStore.getState().openSheet({ kind: "sh3", deviceId: device.id })}
        >
          <Pencil className="ic" aria-hidden="true" />
        </button>
      </div>
    </header>
  );

  if (!device) {
    return (
      <div className="ph" style={{ display: "flex", flexDirection: "column", height: "100%" }}>
        {header("")}
        <div className="body" data-testid="device-missing">
          <p className="cap">{t.notFound}</p>
        </div>
      </div>
    );
  }

  const now = hubNow();
  const offline = state?.online === false;
  const tz = site?.timezone ?? "Asia/Ho_Chi_Minh";
  const lastSeenText = state && state.lastSeen > 0 ? hhmm(state.lastSeen, tz) : "—";
  const values = (state?.values ?? {}) as Record<string, PropertyValue>;
  const at = state?.at ?? {};
  const roomName = device.roomId ? rooms.find((r) => r.id === device.roomId)?.name : undefined;
  const tKey = toggleKey(device);
  const pKey = primaryKey(device);
  const tProp = tKey ? device.properties[tKey] : undefined;
  const pProp = pKey ? device.properties[pKey] : undefined;
  const isOn = tKey ? values[tKey] === true : false;
  const pValue = pProp && values[pProp.key] !== undefined ? formatValue(pProp, values[pProp.key]!) : undefined;

  let heroText: string;
  if (offline) heroText = t.heroOffline;
  else if (tKey && !isOn) heroText = t.heroOff;
  else if (tKey) heroText = pValue ? t.heroOnValue(pValue) : t.heroOn;
  else heroText = pValue ?? t.heroOn;

  const lastState = tProp ? formatValue(tProp, isOn) : undefined;
  const heroSub = offline
    ? t.heroSubOffline(roomName, lastSeenText, lastState)
    : t.heroSub(roomName, pKey && at[pKey] !== undefined ? relativeTime(at[pKey]!, now) : undefined);

  const groups = propertyGroups(device);
  const controls = groups.control!.filter(isWritable);
  const sensors = groups.sensor!;
  const configs = groups.config!;
  const pendingSet = state?.pending ?? new Set<string>();

  const readRow = (p: Property) => (
    <PropertyRow
      key={p.key}
      prop={p}
      value={values[p.key]}
      at={at[p.key]}
      now={now}
      offline={offline}
      atLabel={offline && at[p.key] !== undefined ? hhmm(at[p.key]!, tz) : undefined}
      history={p.category === "sensor" ? { hubId: device.hubId, deviceId: device.id, tz } : undefined}
    />
  );

  return (
    <div className="ph" style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" }}>
      <EditDeviceSheetHost device={device} />
      <DeleteDeviceSheetHost device={device} onDeleted={back} />
      {header(device.name)}
      {offline ? (
        <Banner kind="offline" action={t.retry} onAction={() => void ping()}>
          {t.offlineBanner(lastSeenText)}
        </Banner>
      ) : null}
      <div className="body" style={{ gap: 20, padding: "24px 16px 0" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 16, opacity: offline ? 0.55 : 1 }}>
          <span
            style={{
              width: 56,
              height: 56,
              borderRadius: 16,
              background: offline ? "var(--surface-2)" : "var(--on-tint)",
              color: offline ? "var(--text-muted)" : "var(--accent)",
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              flex: "none",
            }}
          >
            <DeviceIcon icon={device.icon as DeviceIconType} size={32} />
          </span>
          <div className="row-main">
            <span
              className="dn-num"
              style={{ fontSize: 32, lineHeight: "38px", fontWeight: 600, color: offline ? "var(--text-muted)" : undefined }}
              data-testid="hero-status"
            >
              {heroText}
            </span>
            <span className="cap">{heroSub}</span>
          </div>
          {tKey ? (
            <Switch
              checked={isOn}
              pending={pendingSet.has(tKey)}
              disabled={offline}
              label={offline ? t.offlineSwitch : t.toggleLabel(device.name)}
              onChange={(v) => set(tKey, v)}
            />
          ) : null}
        </div>

        {offline ? <OfflineCard /> : null}

        {controls.length > 0 ? (
          <Group title={t.groupControl} dim={offline}>
            {controls.map((p) => (
              <PropertyControl key={p.key} prop={p} value={values[p.key]} pending={pendingSet.has(p.key)} disabled={offline} onSet={set} />
            ))}
          </Group>
        ) : null}

        {sensors.length > 0 ? (
          <Group title={t.groupSensor} dim={offline}>
            {sensors.map(readRow)}
          </Group>
        ) : null}

        {configs.length > 0 ? (
          <Group title={t.groupConfig} dim={offline}>
            {configs.map((p) =>
              isWritable(p) ? (
                <PropertyControl key={p.key} prop={p} value={values[p.key]} pending={pendingSet.has(p.key)} disabled={offline} onSet={set} />
              ) : (
                readRow(p)
              ),
            )}
          </Group>
        ) : null}

        <div>
          <p className="cap" style={{ margin: "0 0 8px" }}>
            {t.groupTech}
          </p>
          <TechGroup device={device} hubName={hub?.name} lqi={state?.lqi} offline={offline} />
        </div>

        <div style={{ padding: "12px 0 32px", display: "flex", flexDirection: "column", gap: 8 }}>
          {offline ? (
            <Button variant="secondary" block onClick={() => void ping()}>
              {t.pingDevice}
            </Button>
          ) : null}
          <Button variant="danger" block onClick={() => uiStore.getState().openSheet({ kind: "sh4", deviceId: device.id })}>
            {t.remove}
          </Button>
        </div>
      </div>
    </div>
  );
}
