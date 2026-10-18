import { useState } from "react";
import { useStore } from "zustand";
import type { RoomId, SiteId } from "@devicenet/shared";
import { Button } from "@/components/dn/Button";
import { Input } from "@/components/dn/Input";
import { Sheet } from "@/components/dn/Sheet";
import { sheetsVi } from "@/i18n/sheets";
import { vi } from "@/i18n/vi";
import { configStore, toastStore, uiStore } from "@/stores";
import { useConfigWrites, useRooms } from "@/transport/hooks";
import { ConfirmDialog } from "./ConfirmDialog";

export interface RoomSheetProps {
  mode: "newRoom";
  siteId?: string | null;
  /** Called with the new room id after `createRoom` resolves. */
  onCreated?: (roomId: string) => void;
}

const actionsStyle = { display: "flex", gap: "var(--space-2)" } as const;
const formStyle = { display: "flex", flexDirection: "column", gap: "var(--space-4)" } as const;
const close = () => uiStore.getState().closeSheet();

/** SH-5 `newRoom` body (rendered inside the shared Sheet). */
export function RoomSheet({ siteId, onCreated }: RoomSheetProps) {
  const s = vi.sh5;
  const writes = useConfigWrites();
  const uiSite = useStore(uiStore, (st) => st.siteId);
  const site = siteId ?? uiSite;
  const siteName = useStore(configStore, (st) => st.sites.find((x) => x.id === site)?.name ?? "");
  const rooms = useRooms(site as never);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const trimmed = name.trim();

  async function submit() {
    if (!trimmed || busy || !site || !writes) return;
    setBusy(true);
    try {
      const id = await writes.createRoom(site, trimmed, rooms.length);
      // Close first: `onCreated` may open another sheet (e.g. back to SH-3).
      close();
      onCreated?.(id);
    } catch {
      toastStore.getState().show({ kind: "error", text: s.createError });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      style={formStyle}
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <Input label={s.roomName} placeholder={s.roomPlaceholder} hint={s.inSite(siteName)} value={name} maxLength={60} onChange={setName} autoFocus />
      <div style={actionsStyle}>
        <Button type="button" variant="secondary" style={{ flex: 1 }} onClick={close}>
          {vi.common.cancel}
        </Button>
        <Button type="submit" variant="primary" style={{ flex: 1 }} loading={busy} disabled={!trimmed || !writes}>
          {s.addRoom}
        </Button>
      </div>
    </form>
  );
}

/** Find a room (and its site) by id across all sites. */
function useRoomRef(roomId: string | undefined) {
  const roomsBySite = useStore(configStore, (st) => st.roomsBySite);
  if (!roomId) return undefined;
  for (const [siteId, rooms] of Object.entries(roomsBySite)) {
    const room = rooms.find((r) => r.id === roomId);
    if (room) return { siteId: siteId as SiteId, room };
  }
  return undefined;
}

function useRoomDeviceIds(roomId: string | undefined): string[] {
  const devices = useStore(configStore, (st) => st.devices);
  return Object.values(devices)
    .filter((d) => d.roomId === roomId && d.status === "active")
    .map((d) => d.id);
}

/** SH-5 `edit`: rename + "Xóa room" (→ confirm). */
function EditRoomBody({ roomId }: { roomId: string }) {
  const s = sheetsVi.sh5;
  const writes = useConfigWrites();
  const ref = useRoomRef(roomId);
  const count = useRoomDeviceIds(roomId).length;
  const siteName = useStore(configStore, (st) => st.sites.find((x) => x.id === ref?.siteId)?.name ?? "");
  const [name, setName] = useState(ref?.room.name ?? "");
  const [busy, setBusy] = useState(false);
  const trimmed = name.trim();
  if (!ref) return null;

  async function save() {
    if (!trimmed || !writes || !ref || busy) return;
    if (trimmed === ref.room.name) return close();
    setBusy(true);
    try {
      await writes.renameRoom(ref.siteId, roomId, trimmed);
      close();
    } catch {
      toastStore.getState().show({ kind: "error", text: s.saveError });
      setBusy(false);
    }
  }

  return (
    <form
      style={formStyle}
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <Input label={s.roomName} hint={s.editHint(count, siteName)} value={name} maxLength={60} onChange={setName} autoFocus />
      <div style={actionsStyle}>
        <Button type="button" variant="secondary" style={{ flex: 1 }} onClick={close}>
          {vi.common.cancel}
        </Button>
        <Button type="submit" variant="primary" style={{ flex: 1 }} loading={busy} disabled={!trimmed || !writes}>
          {s.save}
        </Button>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
        <Button
          type="button"
          variant="danger"
          block
          disabled={!writes}
          onClick={() => uiStore.getState().openSheet({ kind: "sh5", mode: "confirm", roomId })}
        >
          {s.deleteRoom}
        </Button>
        <p className="cap" style={{ margin: 0 }}>
          {s.deleteNote}
        </p>
      </div>
    </form>
  );
}

/** SH-5 `confirm`: delete room batch (devices `roomId=null`, room doc, layout filter). */
function ConfirmRoomDelete({ roomId }: { roomId: string }) {
  const s = sheetsVi.sh5;
  const writes = useConfigWrites();
  const ref = useRoomRef(roomId);
  const deviceIds = useRoomDeviceIds(roomId);
  const layouts = useStore(configStore, (st) => st.layouts);
  const [busy, setBusy] = useState(false);
  if (!ref) return null;

  async function remove() {
    if (!writes || !ref || busy) return;
    setBusy(true);
    try {
      await writes.deleteRoom(ref.siteId, roomId, deviceIds, layouts[ref.siteId]);
      if (uiStore.getState().filter === roomId) uiStore.getState().setFilter("all");
      close();
    } catch {
      toastStore.getState().show({ kind: "error", text: s.deleteError });
      setBusy(false);
    }
  }

  return (
    <ConfirmDialog
      title={s.confirmTitle(ref.room.name)}
      cancelLabel={s.keep}
      confirmLabel={s.deleteRoom}
      confirmDisabled={!writes}
      busy={busy}
      onCancel={close}
      onConfirm={() => void remove()}
    >
      <p className="cap" style={{ margin: 0 }}>
        {s.confirmBody(deviceIds.length)}
      </p>
    </ConfirmDialog>
  );
}

/** SH-5 `newSite`: name + timezone from the browser → `createSite`, then switch to it. */
function NewSiteBody() {
  const s = sheetsVi.sh5;
  const writes = useConfigWrites();
  const count = useStore(configStore, (st) => st.sites.length);
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || "Asia/Ho_Chi_Minh";
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const trimmed = name.trim();

  async function submit() {
    if (!trimmed || !writes || busy) return;
    setBusy(true);
    try {
      const id = await writes.createSite(trimmed, tz, count);
      uiStore.getState().setSiteId(id as SiteId);
      close();
    } catch {
      toastStore.getState().show({ kind: "error", text: s.siteError });
      setBusy(false);
    }
  }

  return (
    <form
      style={formStyle}
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <Input label={s.siteName} placeholder={s.sitePlaceholder} hint={s.siteHint(tz)} value={name} maxLength={60} onChange={setName} autoFocus />
      <p className="cap" style={{ margin: 0 }}>
        {s.siteNote}
      </p>
      <div style={actionsStyle}>
        <Button type="button" variant="secondary" style={{ flex: 1 }} onClick={close}>
          {vi.common.cancel}
        </Button>
        <Button type="submit" variant="primary" style={{ flex: 1 }} loading={busy} disabled={!trimmed || !writes}>
          {s.addSite}
        </Button>
      </div>
    </form>
  );
}

/** SH-5 `pick`: Thêm room / Thêm site. */
function PickBody() {
  const s = sheetsVi.sh5;
  const uiSite = useStore(uiStore, (st) => st.siteId);
  const sites = useStore(configStore, (st) => st.sites);
  const site = sites.find((x) => x.id === uiSite) ?? sites[0];
  const item = (label: string, cap: string, onClick: () => void) => (
    <button
      type="button"
      className="row"
      onClick={onClick}
      style={{ border: 0, background: "transparent", color: "var(--text)", padding: "8px 0", cursor: "pointer", textAlign: "left", width: "100%" }}
    >
      <span className="row-main">
        <span className="lbl">{label}</span>
        <span className="cap">{cap}</span>
      </span>
    </button>
  );
  return (
    <div style={{ display: "flex", flexDirection: "column" }}>
      {item(s.pickRoom, s.pickRoomCap(site?.name ?? ""), () => uiStore.getState().openSheet({ kind: "sh5", mode: "newRoom", siteId: site?.id }))}
      {item(s.pickSite, s.pickSiteCap, () => uiStore.getState().openSheet({ kind: "sh5", mode: "newSite" }))}
    </div>
  );
}

/** Connected SH-5 for SheetHost: renders the right wrapper (bottom sheet or confirm dialog) for `ui.sheet.mode`. */
export function RoomSheetHost({ sheet }: { sheet: { mode: string; [k: string]: unknown } }) {
  const roomId = sheet.roomId as RoomId | undefined;
  const wrap = (title: string, body: React.ReactNode) => (
    <Sheet open title={title} onOpenChange={(o) => !o && close()}>
      {body}
    </Sheet>
  );
  switch (sheet.mode) {
    case "newRoom":
      return wrap(
        vi.sh5.addRoomTitle,
        <RoomSheet mode="newRoom" siteId={sheet.siteId as string | undefined} onCreated={sheet.onCreated as ((id: string) => void) | undefined} />,
      );
    case "edit":
      return roomId ? wrap(sheetsVi.sh5.editTitle, <EditRoomBody roomId={roomId} />) : null;
    case "confirm":
      return roomId ? <ConfirmRoomDelete roomId={roomId} /> : null;
    case "newSite":
      return wrap(sheetsVi.sh5.newSiteTitle, <NewSiteBody />);
    case "pick":
      return wrap(sheetsVi.sh5.pickTitle, <PickBody />);
    default:
      return null;
  }
}
