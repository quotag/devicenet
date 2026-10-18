import { createStore } from "zustand/vanilla";
import type { HubId, HubStatus, PairingState, RunId, RunProgress } from "@devicenet/shared";

export type MqttStatus = "connecting" | "online" | "reconnecting" | "offline";

export interface ConnectionState {
  mqtt: MqttStatus;
  hubStatus: Record<HubId, HubStatus>;
  clockOffset: Record<HubId, number>;
  pairing: Record<HubId, PairingState>;
  runs: Record<RunId, RunProgress>;
  setMqtt(s: MqttStatus): void;
  setHubStatus(hubId: HubId, s: HubStatus): void;
  setClockOffset(hubId: HubId, offset: number): void;
  setPairing(hubId: HubId, p: PairingState | null): void;
  setRun(runId: RunId, r: RunProgress): void;
  reset(): void;
}

const initial = () => ({
  mqtt: "connecting" as MqttStatus,
  hubStatus: {} as Record<HubId, HubStatus>,
  clockOffset: {} as Record<HubId, number>,
  pairing: {} as Record<HubId, PairingState>,
  runs: {} as Record<RunId, RunProgress>,
});

export const connectionStore = createStore<ConnectionState>((set) => ({
  ...initial(),
  setMqtt: (mqtt) => set({ mqtt }),
  setHubStatus: (hubId, s) => set((st) => ({ hubStatus: { ...st.hubStatus, [hubId]: s } })),
  setClockOffset: (hubId, o) => set((st) => ({ clockOffset: { ...st.clockOffset, [hubId]: o } })),
  setPairing: (hubId, p) =>
    set((st) => {
      const pairing = { ...st.pairing };
      if (p) pairing[hubId] = p;
      else delete pairing[hubId];
      return { pairing };
    }),
  setRun: (runId, r) => set((st) => ({ runs: { ...st.runs, [runId]: r } })),
  reset: () => set(initial()),
}));

/** MQTT first, Firestore mirror fallback. */
export function hubOnline(hubId: HubId, mirrorOnline?: boolean): boolean {
  return connectionStore.getState().hubStatus[hubId]?.online ?? mirrorOnline ?? false;
}
