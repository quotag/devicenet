import { createStore } from "zustand/vanilla";
import type { DeviceId, DeviceState, PropertyKey, PropertyValue } from "@devicenet/shared";

export type PendingMap = Record<DeviceId, Record<PropertyKey, { value: PropertyValue; sentAt: number }>>;

export interface DeviceStateStore {
  byId: Record<DeviceId, DeviceState>;
  pending: PendingMap;
  setState(id: DeviceId, s: DeviceState): void;
  removeState(id: DeviceId): void;
  setPending(pending: PendingMap): void;
  reset(): void;
}

export const deviceStateStore = createStore<DeviceStateStore>((set) => ({
  byId: {},
  pending: {},
  setState: (id, s) => set((st) => ({ byId: { ...st.byId, [id]: s } })),
  removeState: (id) =>
    set((st) => {
      const byId = { ...st.byId };
      delete byId[id];
      return { byId };
    }),
  setPending: (pending) => set({ pending }),
  reset: () => set({ byId: {}, pending: {} }),
}));

export function isPending(s: Pick<DeviceStateStore, "pending">, id: DeviceId, key: PropertyKey): boolean {
  return s.pending[id]?.[key] !== undefined;
}

/** Pending value wins over the confirmed one. */
export function display(
  s: Pick<DeviceStateStore, "pending" | "byId">,
  id: DeviceId,
  key: PropertyKey,
): PropertyValue | undefined {
  const values = s.byId[id]?.values as Record<string, PropertyValue> | undefined;
  return s.pending[id]?.[key]?.value ?? values?.[key];
}
