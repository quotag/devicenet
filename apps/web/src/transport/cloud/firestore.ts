// Cloud only. Import dynamically so LAN builds tree-shake `firebase/*`.
import {
  clearIndexedDbPersistence,
  connectFirestoreEmulator,
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
  terminate,
  type Firestore,
} from "firebase/firestore";
import { getFirebase } from "@/lib/firebase";
import { env } from "@/env";

let db: Firestore | null = null;

/** Firestore with persistent multi-tab cache; connects to the emulator when `VITE_USE_EMULATOR=1`. */
export function getDb(): Firestore {
  if (db) return db;
  const { app } = getFirebase();
  db = initializeFirestore(app, {
    localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
  });
  if (env.useEmulator) {
    const [host, port] = (env.firestoreEmulatorHost ?? "localhost:8085").split(":");
    connectFirestoreEmulator(db, host ?? "localhost", Number(port ?? 8085));
  }
  return db;
}

/** Sign-out: terminate Firestore and wipe its offline cache (no tenant data left on the device). */
export async function resetDb(): Promise<void> {
  if (!db) return;
  const d = db;
  db = null;
  await terminate(d);
  await clearIndexedDbPersistence(d);
}
