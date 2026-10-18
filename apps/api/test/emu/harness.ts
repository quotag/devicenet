import { buildServer } from '../../src/server.js';
import type { FastifyInstance } from 'fastify';

process.env.DN_EMULATOR = '1';
process.env.GCLOUD_PROJECT ??= 'demo-devicenet';
process.env.FIREBASE_AUTH_EMULATOR_HOST ??= '127.0.0.1:9099';
process.env.FIRESTORE_EMULATOR_HOST ??= '127.0.0.1:8085';

export const PROJECT = process.env.GCLOUD_PROJECT!;
const AUTH = process.env.FIREBASE_AUTH_EMULATOR_HOST!;
const FS = process.env.FIRESTORE_EMULATOR_HOST!;

export interface TestUser {
  uid: string;
  email: string;
  password: string;
  idToken: string;
}

let n = 0;

async function post(url: string, body: unknown) {
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`${url} -> ${r.status} ${await r.text()}`);
  return (await r.json()) as Record<string, string>;
}

/** Create a user in the Auth emulator and return a fresh ID token. */
export async function createUser(prefix = 'user'): Promise<TestUser> {
  const email = `${prefix}${Date.now()}${n++}@example.com`;
  const password = 'passw0rd!';
  const r = await post(`http://${AUTH}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=fake`, {
    email,
    password,
    returnSecureToken: true,
  });
  return { uid: r.localId!, email, password, idToken: r.idToken! };
}

/** Sign in again to pick up custom claims (equivalent of getIdToken(true)). */
export async function refreshToken(u: TestUser): Promise<string> {
  const r = await post(`http://${AUTH}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=fake`, {
    email: u.email,
    password: u.password,
    returnSecureToken: true,
  });
  return r.idToken!;
}

/** Decode (not verify) a JWT payload. */
export function decodeJwt(token: string): Record<string, any> {
  return JSON.parse(Buffer.from(token.split('.')[1]!, 'base64url').toString());
}

export async function clearFirestore() {
  const r = await fetch(`http://${FS}/emulator/v1/projects/${PROJECT}/databases/(default)/documents`, {
    method: 'DELETE',
  });
  if (!r.ok) throw new Error(`clear firestore failed ${r.status}`);
}

export async function clearAuth() {
  const r = await fetch(`http://${AUTH}/emulator/v1/projects/${PROJECT}/accounts`, { method: 'DELETE' });
  if (!r.ok) throw new Error(`clear auth failed ${r.status}`);
}

export async function startApp(): Promise<FastifyInstance> {
  return buildServer();
}

export const bearer = (token: string) => ({ authorization: `Bearer ${token}` });
