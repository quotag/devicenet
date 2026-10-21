import { getApps, initializeApp, type App } from 'firebase-admin/app';
import { getAuth, type Auth } from 'firebase-admin/auth';
import { getFirestore, type Firestore } from 'firebase-admin/firestore';
import { getConfig } from './config.js';

export function projectId(): string {
  return getConfig().projectId;
}

/** Admin init. Emulator hosts are honoured via FIREBASE_AUTH_EMULATOR_HOST / FIRESTORE_EMULATOR_HOST. */
export function firebaseApp(): App {
  return getApps()[0] ?? initializeApp({ projectId: projectId() });
}

export const auth = (): Auth => getAuth(firebaseApp());
export const db = (): Firestore => getFirestore(firebaseApp());
