import { z } from "zod";

const raw = z.object({
  VITE_MODE: z.enum(["cloud", "lan"]).default("cloud"),
  VITE_USE_EMULATOR: z.string().optional(),
  VITE_FIREBASE_PROJECT_ID: z.string().optional(),
  VITE_FIREBASE_API_KEY: z.string().optional(),
  VITE_AUTH_EMULATOR_URL: z.string().optional(),
  VITE_FIRESTORE_EMULATOR_HOST: z.string().optional(),
  VITE_API_URL: z.string().optional(),
  VITE_MQTT_URL: z.string().optional(),
});

export interface Env {
  mode: "cloud" | "lan";
  useEmulator: boolean;
  firebaseProjectId?: string;
  firebaseApiKey?: string;
  authEmulatorUrl?: string;
  firestoreEmulatorHost?: string;
  apiUrl?: string;
  mqttUrl?: string;
}

export function parseEnv(source: Record<string, unknown>): Env {
  const e = raw.parse(source);
  const env: Env = {
    mode: e.VITE_MODE,
    useEmulator: e.VITE_USE_EMULATOR === "1",
    firebaseProjectId: e.VITE_FIREBASE_PROJECT_ID,
    firebaseApiKey: e.VITE_FIREBASE_API_KEY,
    authEmulatorUrl: e.VITE_AUTH_EMULATOR_URL,
    firestoreEmulatorHost: e.VITE_FIRESTORE_EMULATOR_HOST,
    apiUrl: e.VITE_API_URL,
    mqttUrl: e.VITE_MQTT_URL,
  };
  if (env.mode === "cloud") {
    const missing = (
      ["apiUrl", "mqttUrl", "firebaseProjectId", "firebaseApiKey"] as const
    ).filter((k) => !env[k]);
    if (missing.length) throw new Error(`Missing env for cloud mode: ${missing.join(", ")}`);
  }
  return env;
}

export const env: Env = parseEnv(import.meta.env as Record<string, unknown>);
