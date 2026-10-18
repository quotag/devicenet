import { DndContext, KeyboardSensor, PointerSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { SummaryContext } from "@devicenet/shared";
import { vi } from "@/i18n/vi";
import { BlockRow } from "./RuleBlock";
import type { DraftAction, Keyed } from "./state";
import { actionText } from "./summaries";

const t = vi.s30;

function Item({ k, index, cx, invalid, onEdit }: { k: Keyed<DraftAction>; index: number; cx: SummaryContext; invalid: boolean; onEdit: () => void }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: k.key });
  const text = actionText(k.item, cx);
  return (
    <div ref={setNodeRef} style={{ transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.6 : 1, borderBottom: "1px solid var(--border)" }}>
      <BlockRow
        label={text.label}
        caption={text.caption}
        invalid={invalid}
        onClick={onEdit}
        lead={
          <span
            className="dn-num cap"
            aria-label={`${t.drag} ${index + 1}`}
            style={{ width: 24, textAlign: "center", touchAction: "none", cursor: "grab" }}
            {...attributes}
            {...listeners}
          >
            {index + 1}
          </span>
        }
      />
    </div>
  );
}

export interface ActionListProps {
  actions: Keyed<DraftAction>[];
  cx: SummaryContext;
  invalidKeys: Set<string>;
  onEdit: (key: string) => void;
  onMove: (from: number, to: number) => void;
}

export function ActionList({ actions, cx, invalidKeys, onEdit, onMove }: ActionListProps) {
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));
  const onDragEnd = (e: DragEndEvent) => {
    if (!e.over || e.active.id === e.over.id) return;
    const from = actions.findIndex((a) => a.key === e.active.id);
    const to = actions.findIndex((a) => a.key === e.over!.id);
    if (from >= 0 && to >= 0) onMove(from, to);
  };
  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
      <SortableContext items={actions.map((a) => a.key)} strategy={verticalListSortingStrategy}>
        {actions.map((a, i) => (
          <Item key={a.key} k={a} index={i} cx={cx} invalid={invalidKeys.has(`action:${a.key}`)} onEdit={() => onEdit(a.key)} />
        ))}
      </SortableContext>
    </DndContext>
  );
}
