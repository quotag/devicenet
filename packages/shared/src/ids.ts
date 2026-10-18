/**
 * DeviceNet — ID conventions (shared by app, hub-agent, api)
 *
 * Every entity id is `<prefix>_<ULID>` (26-char Crockford base32, monotonic).
 * The prefix makes ids self-describing in logs and MQTT topics.
 *
 * WHO GENERATES WHAT (do not deviate — it decides who can create offline):
 *   tenant_  api        (POST /v1/tenants/bootstrap)
 *   hub_     api        (POST /v1/hubs/claim)
 *   site_    app
 *   room_    app
 *   dev_     hub-agent  (at Zigbee2MQTT interview_successful; works even if cloud is down)
 *   rule_    app
 *   scn_     app
 *   run_     hub-agent  (one per scene/rule execution)
 *   evt_     hub-agent  (one per event; used for idempotent upload)
 *   cmd_     app        (correlation id for cmd/ack)
 */
import { z } from "zod";

export const ULID_RE = /^[0-9A-HJKMNP-TV-Z]{26}$/;

const prefixed = (p: string) =>
  z.string().regex(new RegExp(`^${p}_[0-9A-HJKMNP-TV-Z]{26}$`), `expected ${p}_<ULID>`);

export const TenantId = prefixed("tenant");
export const HubId = prefixed("hub");
export const SiteId = prefixed("site");
export const RoomId = prefixed("room");
export const DeviceId = prefixed("dev");
export const RuleId = prefixed("rule");
export const SceneId = prefixed("scn");
export const RunId = prefixed("run");
export const EventId = prefixed("evt");
export const CommandId = prefixed("cmd");

export type TenantId = z.infer<typeof TenantId>;
export type HubId = z.infer<typeof HubId>;
export type SiteId = z.infer<typeof SiteId>;
export type RoomId = z.infer<typeof RoomId>;
export type DeviceId = z.infer<typeof DeviceId>;
export type RuleId = z.infer<typeof RuleId>;
export type SceneId = z.infer<typeof SceneId>;
export type RunId = z.infer<typeof RunId>;
export type EventId = z.infer<typeof EventId>;
export type CommandId = z.infer<typeof CommandId>;

/** Firebase Auth uid (opaque string, not ULID) */
export const Uid = z.string().min(1).max(128);

/** Property key inside a device: snake_case, stable, driver-independent */
export const PropertyKey = z.string().regex(/^[a-z][a-z0-9_]{0,63}$/);
export type PropertyKey = z.infer<typeof PropertyKey>;

/** Unix epoch milliseconds (always ms, always UTC, always a number — never ISO strings on the wire) */
export const EpochMs = z.number().int().nonnegative();

/** Monotonic revision counter for config documents (rule/scene/layout) */
export const Rev = z.number().int().nonnegative();
