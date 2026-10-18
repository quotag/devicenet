import { getApps, initializeApp, type App } from 'firebase-admin/app';
import { getAuth, type Auth } from 'firebase-admin/auth';
import { getFirestore, type Firestore } from 'firebase-admin/firestore';

export function projectId(): string {
  return process.env.GCLOUD_PROJECT || process.env.FIREBASE_PROJECT_ID || 'demo-devicenet';
}

/** Admin init. Emulator hosts are honoured via FIREBASE_AUTH_EMULATOR_HOST / FIRESTORE_EMULATOR_HOST. */
export function firebaseApp(): App {
  return getApps()[0] ?? initializeApp({ projectId: projectId() });
}

export const auth = (): Auth => getAuth(firebaseApp());
export const db = (): Firestore => getFirestore(firebaseApp());
