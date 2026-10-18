import { useRef, useState } from "react";
import type { CSSProperties, PointerEvent as ReactPointerEvent } from "react";
import { useStore } from "zustand";
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { SortableContext, rectSortingStrategy, sortableKeyboardCoordinates, useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { DeviceId, RoomId, SiteId } from "@devicenet/shared";
import { vi } from "@/i18n/vi";
import { configStore } from "@/stores";
import { useDevice, useDevices, useRooms } from "@/transport/hooks";
import { HomeTile } from "../HomeTile";
import { deriveTiles, moveTile, resizeTile, type ArrangeTile } from "./layoutModel";
import type { LayoutSaver } from "./layoutSaver";

export interface ArrangeGridProps {
  siteId: SiteId;
  filter: "all" | RoomId;
  timezone: string;
  saver: LayoutSaver;
  /** Grid columns (2 phone, 4 desktop); stored layouts authored for another count are reflowed. */
  cols?: number;
}

/** Horizontal drag on the corner handle beyond this switches size (left → 1×1, right → 2×1). */
const RESIZE_DRAG_PX = 24;
const noop = () => undefined;

/** S-01 arrange mode grid (`S01-SapXep`): @dnd-kit sortable (pointer + keyboard), corner resize handle. */
export function ArrangeGrid({ siteId, filter, timezone, saver, cols = 2 }: ArrangeGridProps) {
  const devices = useDevices(siteId, filter);
  const layout = useStore(configStore, (s) => s.layouts[siteId]);
  const rooms = useRooms(siteId);
  const tiles = deriveTiles(devices, layout, filter, cols);
  const [active, setActive] = useState<ArrangeTile | null>(null);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const roomName = (id: string | null) => rooms.find((r) => r.id === id)?.name ?? null;
  const commit = (next: ArrangeTile[]) => saver.update(siteId, filter, next, cols);

  const onDragStart = (e: DragStartEvent) => setActive(tiles.find((t) => t.id === e.active.id) ?? null);
  const onDragEnd = (e: DragEndEvent) => {
    setActive(null);
    if (e.over && e.active.id !== e.over.id) commit(moveTile(tiles, e.active.id as DeviceId, e.over.id as DeviceId));
  };

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onDragCancel={() => setActive(null)}
    >
      <SortableContext items={tiles.map((t) => t.id)} strategy={rectSortingStrategy}>
        <div
          data-testid="arrange-grid"
          style={{ display: "grid", gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`, gap: 16, padding: "12px 16px 16px" }}
        >
          {tiles.map((t) => (
            <SortableTile
              key={t.id}
              tile={t}
              timezone={timezone}
              room={filter === "all" ? roomName(devices.find((d) => d.id === t.id)?.roomId ?? null) : null}
              onResize={(w) => commit(resizeTile(tiles, t.id, w))}
            />
          ))}
        </div>
      </SortableContext>
      <DragOverlay>
        {active ? (
          <div style={{ transform: "scale(1.04)", filter: "drop-shadow(0 8px 16px rgba(21, 24, 30, .25))" }}>
            <HomeTile deviceId={active.id} timezone={timezone} w={active.w} arranging onOpen={noop} />
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}

function SortableTile({
  tile,
  timezone,
  room,
  onResize,
}: {
  tile: ArrangeTile;
  timezone: string;
  room: string | null;
  onResize: (w?: 1 | 2) => void;
}) {
  const device = useDevice(tile.id);
  const name = device?.name ?? "";
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: tile.id });
  const style: CSSProperties = {
    position: "relative",
    gridColumn: tile.w === 2 ? "span 2" : undefined,
    transform: CSS.Translate.toString(transform),
    transition,
    touchAction: "none",
  };
  return (
    <div
      ref={setNodeRef}
      style={style}
      data-testid={`arrange-tile-${tile.id}`}
      {...attributes}
      {...listeners}
      aria-label={vi.arrange.move(name)}
      aria-roledescription="sortable"
    >
      {isDragging ? (
        <div
          aria-label={vi.arrange.dropSlot}
          style={{
            height: 120,
            boxSizing: "border-box",
            border: "2px dashed var(--accent)",
            borderRadius: 16,
            background: "var(--on-tint)",
          }}
        />
      ) : (
        <>
          <HomeTile deviceId={tile.id} timezone={timezone} w={tile.w} showRoom={room} arranging onOpen={noop} />
          <ResizeHandle wide={tile.w === 2} name={name} onResize={onResize} />
        </>
      )}
    </div>
  );
}

/** Corner handle over DeviceTile's visual `.dn-tile-handle`: drag right → 2×1, left → 1×1; tap/Enter toggles. */
function ResizeHandle({ wide, name, onResize }: { wide: boolean; name: string; onResize: (w?: 1 | 2) => void }) {
  const start = useRef<number | null>(null);
  const dragged = useRef(false);
  const stop = (e: { stopPropagation(): void }) => e.stopPropagation();
  return (
    <button
      type="button"
      className="dn-arrange-resize"
      aria-label={vi.arrange.resize(name, wide)}
      style={{
        position: "absolute",
        right: 0,
        bottom: 0,
        width: 44,
        height: 44,
        border: 0,
        padding: 0,
        background: "transparent",
        cursor: "nwse-resize",
        touchAction: "none",
      }}
      onPointerDown={(e: ReactPointerEvent<HTMLButtonElement>) => {
        stop(e); // keep @dnd-kit from starting a move
        start.current = e.clientX;
        dragged.current = false;
        e.currentTarget.setPointerCapture?.(e.pointerId);
      }}
      onPointerUp={(e) => {
        stop(e);
        if (start.current == null) return;
        const dx = e.clientX - start.current;
        start.current = null;
        if (Math.abs(dx) < RESIZE_DRAG_PX) return;
        dragged.current = true;
        onResize(dx > 0 ? 2 : 1);
      }}
      onKeyDown={stop}
      onClick={(e) => {
        stop(e);
        if (dragged.current) {
          dragged.current = false;
          return;
        }
        onResize();
      }}
    />
  );
}
