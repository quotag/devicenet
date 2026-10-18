// Cloud only. Always loaded with `await import("./firebaseAuth")` behind a VITE_MODE guard so the LAN bundle has no firebase.
import {
  GoogleAuthProvider,
  getRedirectResult,
  onIdTokenChanged,
  signInWithPopup,
  signInWithRedirect,
  signOut as fbSignOut,
  type User,
} from "firebase/auth";
import { getFirebase } from "@/lib/firebase";
import type { AuthUser } from "./session";

function adapt(u: User): AuthUser {
  return {
    uid: u.uid,
    email: u.email ?? "",
    displayName: u.displayName ?? undefined,
    photoUrl: u.photoURL ?? undefined,
    getIdToken: (force) => u.getIdToken(force),
    getTenantClaim: async () => {
      const r = await u.getIdTokenResult();
      return typeof r.claims.tenant === "string" ? r.claims.tenant : undefined;
    },
  };
}

/** `onIdTokenChanged` (sign-in, sign-out, hourly refresh). Returns unsubscribe. */
export function watchAuth(cb: (u: AuthUser | null) => void): () => void {
  void getRedirectResult(getFirebase().auth).catch(() => undefined);
  return onIdTokenChanged(getFirebase().auth, (u) => cb(u ? adapt(u) : null));
}

function isStandalone(): boolean {
  const nav = navigator as Navigator & { standalone?: boolean };
  return nav.standalone === true || window.matchMedia?.("(display-mode: standalone)").matches === true;
}

/** Popup normally; redirect for iOS standalone PWAs where popups are blocked. */
export async function signInWithGoogle(): Promise<void> {
  const { auth } = getFirebase();
  const provider = new GoogleAuthProvider();
  const ios = /iPad|iPhone|iPod/.test(navigator.userAgent);
  if (ios && isStandalone()) await signInWithRedirect(auth, provider);
  else await signInWithPopup(auth, provider);
}

export async function firebaseSignOut(): Promise<void> {
  await fbSignOut(getFirebase().auth);
}
