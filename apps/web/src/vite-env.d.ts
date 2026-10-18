/// <reference types="vite/client" />

declare const __APP_VERSION__: string;

interface ImportMetaEnv {
  readonly VITE_MODE?: "cloud" | "lan";
  readonly VITE_USE_EMULATOR?: string;
  readonly VITE_FIREBASE_PROJECT_ID?: string;
  readonly VITE_FIREBASE_API_KEY?: string;
  readonly VITE_AUTH_EMULATOR_URL?: string;
  readonly VITE_FIRESTORE_EMULATOR_HOST?: string;
  readonly VITE_API_URL?: string;
  readonly VITE_MQTT_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
