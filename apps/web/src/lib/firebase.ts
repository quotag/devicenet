// Cloud only. Import dynamically (`await import("@/lib/firebase")`) so LAN builds tree-shake it.
// Firestore init lives in `src/transport/cloud/firestore.ts` (constitution: firestore only inside transport/).
import { initializeApp, getApps, type FirebaseApp } from "firebase/app";
import { connectAuthEmulator, getAuth, type Auth } from "firebase/auth";
import { env } from "@/env";

export interface FirebaseHandles {
  app: FirebaseApp;
  auth: Auth;
}

let handles: FirebaseHandles | null = null;

export function getFirebase(): FirebaseHandles {
  if (handles) return handles;
  const projectId = env.firebaseProjectId ?? "demo-devicenet";
  const app = getApps()[0] ?? initializeApp({ projectId, apiKey: env.firebaseApiKey ?? "demo-key" });
  const auth = getAuth(app);
  if (env.useEmulator) {
    connectAuthEmulator(auth, env.authEmulatorUrl ?? "http://localhost:9099", { disableWarnings: true });
  }
  handles = { app, auth };
  return handles;
}
