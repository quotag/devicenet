/**
 * DeviceNet — Firestore document shapes (the CONFIG path, never the state path)
 *
 * All tenant data lives under `tenants/{tenantId}/...` so Security Rules filter once.
 * Realtime device VALUES are NOT here (they are MQTT retained). Firestore holds only what must
 * outlive a connection: identity, structure, config, layout, events, snapshots.
 *
 * Writer column is enforced by firestore.rules — see ./firestore.rules.
 * Timestamps are epoch ms numbers (not Firestore Timestamp) so hub/app/api share one type.
 */
import { z } from "zod";
import { DeviceId, EpochMs, EventId, HubId, PropertyKey, Rev, RoomId, SiteId, TenantId, Uid } from "./ids";
import { PropertyMap } from "./property";
export { Rule, Scene } from "./rule";

/** tenants/{tenantId} — writer: api */
export const Tenant = z.object({
  id: TenantId,
  name: z.string().min(1).max(60),
  ownerUid: Uid,
  createdAt: EpochMs,
  plan: z.enum(["home"]).default("home"),
});

/** tenants/{t}/members/{uid} — writer: api (role), app (prefs, fcmTokens) */
export const Member = z.object({
  uid: Uid,
  role: z.enum(["owner", "member"]), // Phase 3 adds staff/guest
  email: z.string().email(),
  displayName: z.string().max(100).optional(),
  photoUrl: z.string().url().optional(),
  joinedAt: EpochMs,
  prefs: z.object({
    language: z.enum(["vi", "en"]).default("vi"),
    tempUnit: z.enum(["C", "F"]).default("C"),
    theme: z.enum(["light", "dark", "system"]).default("system"),
  }).optional(),
  fcmTokens: z.array(z.string()).optional(), // Phase 2
});

/** tenants/{t}/sites/{siteId} — writer: app */
export const Site = z.object({
  id: SiteId,
  name: z.string().min(1).max(60),
  /** IANA tz, e.g. "Asia/Ho_Chi_Minh" — hub uses for schedule/sun */
  timezone: z.string().min(1),
  lat: z.number().min(-90).max(90).optional(),
  lng: z.number().min(-180).max(180).optional(),
  order: z.number().int().default(0),
  createdAt: EpochMs,
});

/** tenants/{t}/sites/{s}/rooms/{roomId} — writer: app */
export const Room = z.object({
  id: RoomId,
  name: z.string().min(1).max(40),
  icon: z.string().max(40).optional(),
  order: z.number().int().default(0),
});

/** tenants/{t}/hubs/{hubId} — writer: api (create, secretHash), hub (status fields), app (name, siteId) */
export const Hub = z.object({
  id: HubId,
  siteId: SiteId,
  name: z.string().min(1).max(60),
  claimedAt: EpochMs,
  claimedBy: Uid,
  // --- mirrored from MQTT status by api webhook (see spec 001 §Status mirror) ---
  online: z.boolean(),
  lastSeen: EpochMs,
  agentVersion: z.string().optional(),
  z2mVersion: z.string().optional(),
  platform: z.enum(["windows", "linux"]).optional(),
  lanUrl: z.string().url().optional(),
  ip: z.string().optional(),
  drivers: z.array(z.string()).default(["zigbee2mqtt"]),
  deviceCount: z.number().int().nonnegative().optional(),
  /** sha256 of MQTT secret — api only; rules deny client read of this field via separate doc: hubs/{id}/private/secret */
});

/** tenants/{t}/hubs/{hubId}/private/secret — writer/reader: api only */
export const HubSecret = z.object({
  secretHash: z.string(),
  alg: z.literal("sha256"),
  rotatedAt: EpochMs,
});

export const DeviceStatus = z.enum(["new", "active", "removed"]);

/** tenants/{t}/devices/{deviceId} — writer: hub (create, properties, status, model fields), app (name, roomId, icon, primaryProperty, labels) */
export const Device = z.object({
  id: DeviceId,
  hubId: HubId,
  siteId: SiteId,
  roomId: RoomId.nullable(),
  driver: z.literal("zigbee2mqtt"), // Phase 3 widens
  /** Driver identity: ieee address for Zigbee */
  externalId: z.string().min(1),
  model: z.string().optional(),
  vendor: z.string().optional(),
  description: z.string().optional(),
  firmware: z.string().optional(),
  name: z.string().min(1).max(60),
  icon: z.string().max(40).default("plug"),
  /** Property key shown big on the tile; must exist in `properties` */
  primaryProperty: PropertyKey.optional(),
  /** Property key bound to the tile toggle; default = first writable binary */
  toggleProperty: PropertyKey.optional(),
  properties: PropertyMap,
  status: DeviceStatus,
  createdAt: EpochMs,
  updatedAt: EpochMs,
  removedAt: EpochMs.optional(),
});
export type Device = z.infer<typeof Device>;

/**
 * tenants/{t}/layouts/{siteId} — writer: app
 * Decision D-02: one layout per (site, filter). filter = "all" | roomId.
 * Devices absent from a filter's list are appended in createdAt order.
 */
export const TileRect = z.object({ x: z.number().int().min(0), y: z.number().int().min(0), w: z.union([z.literal(1), z.literal(2)]), h: z.literal(1) });
export const Layout = z.object({
  siteId: SiteId,
  rev: Rev,
  updatedAt: EpochMs,
  filters: z.record(z.string(), z.object({
    /** column count the layout was authored for (2 on phone, 4 on desktop); app reflows if different */
    cols: z.number().int().min(2).max(6).default(2),
    tiles: z.record(DeviceId, TileRect),
  })),
});
export type Layout = z.infer<typeof Layout>;

/** tenants/{t}/events/{eventId} — writer: hub (via client SDK with custom token). TTL 30 days (Firestore TTL policy on `expireAt`). */
export const EventDoc = z.object({
  id: EventId,
  hubId: HubId,
  ts: EpochMs,
  type: z.string(),
  deviceId: DeviceId.optional(),
  ruleId: z.string().optional(),
  sceneId: z.string().optional(),
  runId: z.string().optional(),
  result: z.string().optional(),
  title: z.string().optional(),
  detail: z.record(z.string(), z.unknown()).optional(),
  /** ts + 30d, as Firestore Timestamp in the real doc for TTL */
  expireAt: EpochMs,
});

/** claimCodes/{code} — ROOT collection, api only (rules deny all client access) */
export const ClaimCode = z.object({
  code: z.string().regex(/^[A-HJ-NP-Z2-9]{8}$/), // base32 without 0/O/1/I
  hubPubKey: z.string(), // base64 X25519 or RSA-OAEP public key
  createdAt: EpochMs,
  expiresAt: EpochMs, // createdAt + 15 min (decision: 15, not 10)
  used: z.boolean(),
  /** set at claim: encrypted credential blob the hub polls for; deleted after first successful GET */
  credential: z.string().optional(),
  tenantId: TenantId.optional(),
  hubId: HubId.optional(),
});
