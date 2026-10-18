import { useStore } from "zustand";
import type { SiteId } from "@devicenet/shared";
import { Chip } from "@/components/dn/Chip";
import { useLongPress } from "@/features/automate/useLongPress";
import { vi } from "@/i18n/vi";
import { uiStore } from "@/stores";
import { useRooms } from "@/transport/hooks";

function RoomChip({ room, selected, editable }: { room: { id: string; name: string }; selected: boolean; editable: boolean }) {
  const lp = useLongPress(() => uiStore.getState().openSheet({ kind: "sh5", mode: "edit", roomId: room.id }));
  return (
    <Chip
      selected={selected}
      {...(editable ? lp.handlers : {})}
      onClick={() => {
        if (editable && lp.shouldIgnoreClick()) return;
        uiStore.getState().setFilter(room.id);
      }}
    >
      {room.name}
    </Chip>
  );
}

/** "Tất cả" + rooms by `order` + dashed add chip (→ SH-5 newRoom). Long-press (500 ms) a room chip → SH-5 edit. */
export function RoomChips({ siteId, canAdd = true }: { siteId: SiteId; canAdd?: boolean }) {
  const rooms = [...useRooms(siteId)].sort((a, b) => a.order - b.order);
  const filter = useStore(uiStore, (s) => s.filter);
  const ui = uiStore.getState();
  return (
    <div style={{ display: "flex", gap: 8, padding: "12px 16px 4px", overflowX: "auto", whiteSpace: "nowrap" }}>
      <Chip selected={filter === "all"} onClick={() => ui.setFilter("all")}>
        {vi.common.all}
      </Chip>
      {rooms.map((r) => (
        <RoomChip key={r.id} room={r} selected={filter === r.id} editable={canAdd} />
      ))}
      {canAdd ? (
        <Chip add aria-label={vi.home.addRoom} onClick={() => ui.openSheet({ kind: "sh5", mode: "newRoom", siteId })} />
      ) : null}
    </div>
  );
}
