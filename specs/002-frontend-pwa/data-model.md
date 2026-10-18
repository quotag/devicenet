# Data model (Phase 1): 002 – client-side state

Wire payloads (MQTT), Firestore documents, rule/scene schemas, ids and timeouts are defined **only** in [`specs/000-shared-contracts`](../000-shared-contracts/data-model.md) and consumed from `@devicenet/shared`. This file describes the web app's **in-memory stores and view models** built from those types. No field here is persisted except where noted.

## Stores (Zustand vanilla, `src/stores/`)

### `session`
| Field | Type | Notes |
|---|---|---|
| `mode` | `"cloud" \| "lan"` | from `VITE_MODE` |
| `status` | `"booting" \| "signedOut" \| "bootstrapping" \| "ready"` | guards read this |
| `user` | `{uid, email, displayName?, photoUrl?} \| null` | cloud only |
| `tenantId` | `TenantId \| null` | claim `tenant` / `/api/config.tenantId` |
| `idToken` | `string \| null` | MQTT password (cloud) |
Transitions: `booting → signedOut → bootstrapping → ready`; `ready → signedOut` on sign-out (all stores reset).

### `connection`
| Field | Type | Notes |
|---|---|---|
| `mqtt` | `"connecting" \| "online" \| "reconnecting" \| "offline"` | → StatusBanner reconnecting |
| `hubStatus` | `Record<HubId, HubStatus>` | from retained/live `status` |
| `clockOffset` | `Record<HubId, number>` | median of 5 live samples (research R5) |
| `pairing` | `Record<HubId, PairingState>` | retained |
| `runs` | `Record<RunId, RunProgress>` | post-M-Local (S-02) |
Derived: `hubOnline(hubId) = hubStatus[hubId]?.online ?? hubs[hubId].online` (MQTT first, Firestore mirror fallback).

### `deviceState`
| Field | Type | Notes |
|---|---|---|
| `byId` | `Record<DeviceId, DeviceState>` | confirmed only; removed on empty retained payload |
| `pending` | `Record<DeviceId, Record<PropertyKey, {value: PropertyValue, sentAt: number}>>` | timers live in `PendingTracker`, not store |
Derived per tile: `display(key) = pending?.[key]?.value ?? byId.values[key]`, `isPending(key)`.

### `config`
| Field | Type | Notes |
|---|---|---|
| `sites` | `Site[]` | ordered by `order` |
| `roomsBySite` | `Record<SiteId, Room[]>` | |
| `hubs` | `Record<HubId, Hub>` | |
| `devices` | `Record<DeviceId, Device>` | all statuses; selectors filter |
| `rules`, `scenes` | `Record<id, Rule \| Scene>` | post-M-Local |
| `layouts` | `Record<SiteId, Layout>` | post-M-Local writes; read in M-Local |
| `events` | `EventDoc[]` | post-M-Local |
| `loaded` | `Record<collection, boolean>` | loading skeleton |
| `fromCache` | `boolean` | Firestore metadata / LAN `cachedAt` → dimmed tiles (P8) |

### `ui`
| Field | Type | Notes |
|---|---|---|
| `siteId` | `SiteId \| null` | current site (default first) — persisted localStorage |
| `filter` | `"all" \| RoomId` | Home chips |
| `arranging` | `boolean` | post-M-Local |
| `sheet` | discriminated union `{kind:"sh2", ctx:"home"\|"automate"} \| {kind:"sh5", mode, …} \| …` | rendered by SheetHost |
| `highlight` | `{deviceId, until} \| null` | tile accent 2 s after S-11 |
| `theme` | `"light" \| "dark" \| "system"` | localStorage + `members/{uid}.prefs` (P3) |

### `toast`
`current: {kind: "timeout" | "error" | "update", text: string, action?: {label, run}} | null` — one at a time (FR-F14); auto-hide handled by Toast component.

## View models (`src/lib/deviceView.ts`, pure)
- `toggleKey(device)` = `device.toggleProperty` ?? first writable `binary` property.
- `primaryKey(device)` = `device.primaryProperty` ?? first `sensor` numeric; none → show "Bật"/"Tắt" (FR-F01).
- `secondarySensors(device, n=2)` for 2×1 tiles.
- `homeDevices(siteId, filter)` = devices with `status === "active"` in site (and room), ordered by `layouts[site].filters[filter].tiles` then `createdAt` (D-02). `status:"new"` never on Home (spec §9).
- `foundDevices(hubId)` = `status === "new"` for S-11.
- `propertyGroups(device)` → control / sensor / config / diag (S-20).

## State transitions worth testing
- Pending key: `none → pending (set sent) → none (state matches) | none + toast (3 s / set.rejected)`.
- S-11 step 2: `idle → starting (cmd sent) → active (retained pairing.active) → expired (pairing.active=false or remaining ≤ 0, found empty) | found ≥ 1`; leaving screen → `pairing.stop`.
- S-10 step 3: `confirming (claim POST) → waitingHub → online (Firestore hubs/{id}.online OR MQTT status.online)`; > 60 s → hint.
