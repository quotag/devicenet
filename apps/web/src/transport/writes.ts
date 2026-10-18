import { ulid } from "ulid";
import type { Layout } from "@devicenet/shared";
import { paths } from "@/lib/paths";
import type { Rule, Scene } from "@devicenet/shared";

/** Cloud-side presentation writes. Field sets mirror firestore.rules (user may only change listed keys). */

export interface DevicePresentation {
  name: string;
  roomId: string | null;
  icon: string;
  primaryProperty?: string;
  status?: "active";
}

export function devicePresentationPatch(p: DevicePresentation, now = Date.now()): Record<string, unknown> {
  const patch: Record<string, unknown> = { name: p.name, roomId: p.roomId, icon: p.icon, updatedAt: now };
  if (p.primaryProperty !== undefined) patch.primaryProperty = p.primaryProperty;
  if (p.status) patch.status = p.status;
  return patch;
}

export function roomDoc(name: string, order: number, id = `room_${ulid()}`) {
  return { id, name, order };
}

export function siteDoc(name: string, timezone: string, order = 0, now = Date.now(), id = `site_${ulid()}`) {
  return { id, name, timezone, order, createdAt: now };
}

export function hubRenamePatch(name: string, siteId?: string): Record<string, unknown> {
  return siteId ? { name, siteId } : { name };
}

/** App-side rule toggle: `enabled` + `rev+1` + `updatedAt` only (hub-owned fields stay untouched). */
export function ruleEnabledPatch(enabled: boolean, rev: number, now = Date.now()): Record<string, unknown> {
  return { enabled, rev: rev + 1, updatedAt: now };
}

type Segs = [string, ...string[]];

async function fs() {
  const [{ getDb }, f] = await Promise.all([import("./cloud/firestore"), import("firebase/firestore")]);
  return { db: getDb(), ...f };
}

export async function updateDevicePresentation(tenantId: string, id: string, p: DevicePresentation): Promise<void> {
  const { db, doc, updateDoc } = await fs();
  await updateDoc(doc(db, ...(paths.device(tenantId, id) as Segs)), devicePresentationPatch(p));
}

export async function createRoom(tenantId: string, siteId: string, name: string, order = 0): Promise<string> {
  const { db, doc, setDoc } = await fs();
  const room = roomDoc(name, order);
  await setDoc(doc(db, ...(paths.room(tenantId, siteId, room.id) as Segs)), room);
  return room.id;
}

export async function createSite(tenantId: string, name: string, timezone: string, order = 0): Promise<string> {
  const { db, doc, setDoc } = await fs();
  const site = siteDoc(name, timezone, order);
  await setDoc(doc(db, ...(paths.site(tenantId, site.id) as Segs)), site);
  return site.id;
}

export async function renameHub(tenantId: string, hubId: string, name: string, siteId?: string): Promise<void> {
  const { db, doc, updateDoc } = await fs();
  await updateDoc(doc(db, ...(paths.hub(tenantId, hubId) as Segs)), hubRenamePatch(name, siteId));
}

export async function setRuleEnabled(tenantId: string, ruleId: string, enabled: boolean, rev: number): Promise<void> {
  const { db, doc, updateDoc } = await fs();
  await updateDoc(doc(db, ...(paths.rule(tenantId, ruleId) as Segs)), ruleEnabledPatch(enabled, rev));
}

// ---------- B18: S-30 save (rule / scene) ----------

/** App-writable keys (firestore.rules `onlyChanging`); hub-owned fields are never written. */
const RULE_KEYS = ["id", "siteId", "hubId", "name", "icon", "enabled", "trigger", "conditions", "actions", "rev", "updatedAt"] as const;
const SCENE_KEYS = ["id", "siteId", "hubId", "name", "icon", "actions", "rev", "updatedAt"] as const;
/** Optional keys that must be removed on update when the editor cleared them. */
const OPTIONAL_KEYS = new Set(["icon", "conditions"]);

export function configDocPayload(kind: "rule" | "scene", d: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of kind === "rule" ? RULE_KEYS : SCENE_KEYS) if (d[k] !== undefined) out[k] = d[k];
  return out;
}

async function saveConfigDoc(kind: "rule" | "scene", tenantId: string, d: { id: string } & Record<string, unknown>, isNew: boolean) {
  const { db, doc, setDoc, updateDoc, deleteField } = await fs();
  const ref = doc(db, ...((kind === "rule" ? paths.rule(tenantId, d.id) : paths.scene(tenantId, d.id)) as Segs));
  const payload = configDocPayload(kind, d);
  if (isNew) return setDoc(ref, payload);
  const { id: _id, ...patch } = payload;
  for (const k of OPTIONAL_KEYS) if (patch[k] === undefined && (kind === "rule" || k !== "conditions")) patch[k] = deleteField();
  return updateDoc(ref, patch);
}

/** `rule` must already carry `rev+1`, `updatedAt`, `hubId` (see editor/save.ts). */
export async function saveRule(tenantId: string, rule: Rule, isNew: boolean): Promise<void> {
  await saveConfigDoc("rule", tenantId, rule, isNew);
}

export async function saveScene(tenantId: string, scene: Scene, isNew: boolean): Promise<void> {
  await saveConfigDoc("scene", tenantId, scene, isNew);
}

export interface MemberPrefs {
  language?: "vi" | "en";
  tempUnit?: "C" | "F";
  theme?: "light" | "dark" | "system";
}

/** Only `prefs.*` keys (firestore.rules lets the app write prefs on its own member doc). */
export function prefsPatch(p: MemberPrefs): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(p)) if (v !== undefined) out[`prefs.${k}`] = v;
  return out;
}

export async function setPrefs(tenantId: string, uid: string, p: MemberPrefs): Promise<void> {
  const { db, doc, updateDoc } = await fs();
  await updateDoc(doc(db, ...(paths.member(tenantId, uid) as Segs)), prefsPatch(p));
}

/** Whole `layouts/{siteId}` doc (D-02). Caller bumps `rev + 1` / `updatedAt` (arrange `bumpLayout`, debounced 500 ms). */
export async function saveLayout(tenantId: string, layout: Layout): Promise<void> {
  const { db, doc, setDoc } = await fs();
  await setDoc(doc(db, ...(paths.layout(tenantId, layout.siteId) as Segs)), layout);
}

// ---------- B21: SH-5 room edit/delete, SH-6 delete rule/scene ----------

export function roomRenamePatch(name: string): Record<string, unknown> {
  return { name };
}

export interface RoomDeletePlan {
  /** Per-device patch: `roomId: null` (devices stay on the hub). */
  devicePatch: Record<string, unknown>;
  deviceIds: string[];
  /** `layouts/{siteId}` patch dropping the room's filter; `null` when the layout has no such filter. */
  layoutPatch: { fieldPath: string; rev: number; updatedAt: number } | null;
}

export function roomDeletePlan(
  roomId: string,
  deviceIds: readonly string[],
  layout: Pick<Layout, "rev" | "filters"> | undefined,
  now = Date.now(),
): RoomDeletePlan {
  return {
    devicePatch: { roomId: null, updatedAt: now },
    deviceIds: [...deviceIds],
    layoutPatch: layout && roomId in layout.filters ? { fieldPath: `filters.${roomId}`, rev: layout.rev + 1, updatedAt: now } : null,
  };
}

export async function renameRoom(tenantId: string, siteId: string, roomId: string, name: string): Promise<void> {
  const { db, doc, updateDoc } = await fs();
  await updateDoc(doc(db, ...(paths.room(tenantId, siteId, roomId) as Segs)), roomRenamePatch(name));
}

/** One batch: devices `roomId=null`, delete room doc, drop the room's layout filter (rev+1). */
export async function deleteRoom(
  tenantId: string,
  siteId: string,
  roomId: string,
  deviceIds: readonly string[],
  layout?: Pick<Layout, "rev" | "filters">,
): Promise<void> {
  const { db, doc, writeBatch, deleteField } = await fs();
  const plan = roomDeletePlan(roomId, deviceIds, layout);
  const batch = writeBatch(db);
  for (const id of plan.deviceIds) batch.update(doc(db, ...(paths.device(tenantId, id) as Segs)), plan.devicePatch);
  if (plan.layoutPatch) {
    const { fieldPath, rev, updatedAt } = plan.layoutPatch;
    batch.update(doc(db, ...(paths.layout(tenantId, siteId) as Segs)), { [fieldPath]: deleteField(), rev, updatedAt });
  }
  batch.delete(doc(db, ...(paths.room(tenantId, siteId, roomId) as Segs)));
  await batch.commit();
}

export async function deleteRule(tenantId: string, ruleId: string): Promise<void> {
  const { db, doc, deleteDoc } = await fs();
  await deleteDoc(doc(db, ...(paths.rule(tenantId, ruleId) as Segs)));
}

export async function deleteScene(tenantId: string, sceneId: string): Promise<void> {
  const { db, doc, deleteDoc } = await fs();
  await deleteDoc(doc(db, ...(paths.scene(tenantId, sceneId) as Segs)));
}
