# Data model — 001 Backend

**All shared entities** (Tenant, Member, Site, Room, Hub, HubSecret, Device, Property, Rule, Scene, Layout, EventDoc, ClaimCode, every MQTT payload) are defined in `specs/000-shared-contracts/data-model.md` + `contracts/*.ts` and imported from `@devicenet/shared`. **Nothing below redefines them.** This file only lists state that is private to hub-agent or api (never on a wire, never in Firestore).

## 1. Hub-agent local files (`dataDir`, default `./.data/hub` in dev)

| File | Content | Notes |
|---|---|---|
| `config.yaml` | `serialPort: auto\|COMx\|/dev/serial/by-id/...`, `dataDir`, `apiBaseUrl`, `lan {enabled, bind, port: 8080, webDir}`, `mqttLocal {port: 1883, wsPort: 9001}`, `log {level}` | Validated by a hub-internal Zod schema (`src/config/schema.ts`) — internal config, not a contract. Env overrides: `DN_EMULATOR`, `DN_MOCK_Z2M`, `DN_API_BASE_URL`, `DN_CLOUD_MQTT_TLS`. |
| `hub.key` | `{pk, sk}` base64 X25519 (libsodium) | 0600; deleted by `devicenet-agent reset`. |
| `credentials.json` | decrypted credential: `{tenantId, hubId, siteId, mqtt{host,port,wssPort,username,password}, firebaseCustomToken, apiBaseUrl}` (shape from api.openapi.yaml) | 0600; parsed with a local Zod mirror of the OpenAPI shape (OpenAPI, not a TS contract, defines it). Token refreshed in place (OQ-5). |
| `mosquitto/{mosquitto.conf,passwd,acl}` | generated each start | users `hub`, `z2m` (random passwords in `secrets.json`); listener 1883 bound 127.0.0.1 (password), 9001 ws 0.0.0.0 anonymous with ACL FR-H11; `per_listener_settings true`. |
| `z2m/configuration.yaml` | generated/merged (research R1) | Z2M owns `devices:`/`groups:` + `database.db`; never deleted by reset. |
| `run/*.pid`, `logs/` | child PIDs, pino logs (7-day rotation) | |
| `hub.db` | SQLite (§2) | |

## 2. SQLite `hub.db` (better-sqlite3, WAL)

| Table | Columns | Purpose / rules |
|---|---|---|
| `meta` | `key TEXT PK, value TEXT` | `schemaVersion`, `lastHeartbeatAt` (OQ-6), `lastConfigSyncAt`. |
| `devices` | `id PK (dev_…), external_id UNIQUE (ieee), doc JSON (Device), values JSON, at JSON, online INT, last_seen INT, synced INT` | Cold-start registry. `synced=0` → reconciler rewrites Firestore. Re-pairing conflict resolution: xóa bản ghi cũ có `status='removed'` cùng `external_id` trước khi upsert. |
| `config_snapshot` | `kind ('site'\|'rooms'\|'devices'\|'rules'\|'scenes'\|'layout') PK, json, etag, cached_at` | Serves `/api/config` + engine cold start. |
| `history` | `device_id, property, ts, value REAL`; index `(device_id, property, ts)` | ≤1 row/10 s/property; 7-day retention, hourly cleanup. |
| `events` | `id PK (evt_…), ts, type, json (HubEvent), uploaded INT` | 30-day retention; source of `/api/events` and the Firestore uploader. |
| `rule_state` | `rule_id PK, last_run_at, last_result, pending_write INT` | Coalesces Firestore `lastRunAt/lastResult` ≤1/10 s. |

Migrations: numbered SQL in `src/store/migrations.ts`, applied at boot inside one transaction.

## 3. Hub in-memory state

- **Registry entry** (`core/registry`): `{device: Device, values, at, online, lastSeen, lqi?}` keyed by `deviceId`, plus `externalId → deviceId` và `friendlyName → deviceId` maps. Values merged only for keys in `device.properties` (FR-H04).
- **Publisher**: `seq` counter (reset at boot), last-published snapshot per device for change detection, coalescer timers.
- **Cmd dedupe**: LRU `cmd.id → expiresAt` (60 s).
- **Set queue**: per-device promise chain (concurrency 1).
- **Pairing**: `{active, startedAt, expiresAt, found[], timer}`; mutex cho `pairing.*`. Quét `knownDevices` khi start để phát hiện thiết bị đã interview.
- **Engine** (post M-Local): `Map<"dev.prop", CompiledRule[]>`, per-rule `{prev, forTimer, appliedRev}`, active runs `runId → {cancel}`. Target state awareness: không kích hoạt nếu thuộc tính hành động đã đạt targetValue. Scheduler phân đoạn chained timeouts khi delay > 24 ngày (`MAX_TIMEOUT_MS`).

## 4. State machines

**Hub lifecycle**: `unclaimed` (key pair, request code, poll 3 s, new code every 15 min) → `claimed` (credentials.json present) → `online-cloud` / `offline-cloud` (bridge link state; independent of LAN).
- `devicenet-agent reset` / `POST /setup/reset` (LAN setup) → `unclaimed` (xóa credentials, giữ Z2M db và `devices` table).
- **Auto-unclaim**: Khi Firestore xóa doc hub (`onHubDeleted`) hoặc token bị từ chối 401/404 → tự động gọi `goUnclaimed()`, ngắt bridge cloud, xóa credentials và quay về `unclaimed` phục vụ LAN `/setup`.
Before claim: supervisor, Z2M, driver, local broker, `/setup`, `/api/health` run; no `t/…` topics are published (tenant unknown); pairing refused (D-12).

**Device** (`Device.status`, contract): hub creates `new` → app sets `active` → hub sets `removed` (+ `removedAt`, retained state cleared, referencing rules/scenes `broken`). Re-pair cùng IEEE: di chuyển identity sang site/hub hiện tại, xóa bản ghi removed cũ trong DB, chuyển về `new` và phát `device.found`.

**Pairing**: `idle` → `pairing.start` (quét `knownDevices`, thêm thiết bị `new`/đã interview vào `found`) → `active(expiresAt)` → (timer | `pairing.stop` | Z2M permit_join false) → `idle` (`permit_join {time:0}` sent defensively).

**Command handling**: received → dedupe → `CommandEnvelope.safeParse` (fail → ack `invalid`) → handler with 5 s guard (late → ack `timeout`) → ack.

## 5. API private state

- `claimCodes/{code}` (contract `ClaimCode`) + api-only field `credentialTakenAt` (EpochMs) to distinguish "consumed" (410) from "not yet claimed" (404). Root collection is client-deny in rules, so the extra field is invisible to clients. *(Additive api-internal field; listed here, not a contract change.)*
- In-memory caches: EMQX auth/acl result per username 60 s (FR-A04); webhook last `(ts, seq)` per hub (FR-A05) — authoritative check is a Firestore transaction comparing `payload.ts` with stored `lastSeen` (LWT `ts=0` → applied with `lastSeen = publish_received_at`).
- Rate limits (`@fastify/rate-limit`, in-memory): `claim-codes` 10/h/IP, `claim` 20/h/uid; disabled when `DN_EMULATOR=1`.

## 6. Validation rules (where enforced)
- Every MQTT payload in/out: `@devicenet/shared` schema `safeParse` at the bridge boundary; hub-published payloads are parsed in tests (not at runtime, for cost).
- `set`: every key `validateValue` + `isWritable`; any failure → `events set.rejected`, whole message dropped; device offline → `set.rejected reason=device_offline` ≤1 s.
- Firestore writes by hub: parsed with `Device`/`EventDoc` before `setDoc`; field set limited to the rules' hub column (`firestore.rules`).
