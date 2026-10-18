# Research (Phase 0): 002 – Frontend PWA

All Technical Context unknowns resolved. Format: Decision · Rationale · Alternatives. Items needing other teams are in [open-questions.md](./open-questions.md).

## R1 Router layout
- **Decision**: TanStack Router with a **code-based** route tree in `src/app/router.tsx`; tab routes under a pathless `_tabs` layout (`TabLayout`); full-screen flows (`/onboarding/*`, `/device/$id`, S-30) outside it; guards in `beforeLoad`. Sheets are UI state (`ui.sheet`), not routes.
- **Rationale**: no codegen plugin → deterministic for small-context agents; sheets over a visible screen (SH-3 over S-20, SH-1/SH-2 over Home) are simpler as state than as nested routes; desktop turns them into dialogs without URL changes.
- **Alternatives**: file-based routing (`@tanstack/router-plugin`) — extra generated file churn across parallel agents; search-param sheets — deep-link value low in v1.

## R2 Store design
- **Decision**: Zustand **vanilla** stores (`createStore`) — `deviceState`, `connection`, `config`, `session`, `ui`, `toast` — owned/written by `transport/` and feature actions; React reads via `useStore(store, selector)` wrapped in hooks (`useDeviceState(id)` selects one entry). See data-model.md.
- **Rationale**: transport tests run in node without React; per-device selectors avoid re-rendering 50 tiles (spec §3); one place to reset on sign-out.
- **Alternatives**: TanStack Query for Firestore/MQTT data — wrong model for push streams; React context — re-render storms.

## R3 MQTT client strategy
- **Decision**: single mqtt.js 5 client per session (`mqtt.connect(url, {clean:true, keepalive:30, reconnectPeriod, clientId:'web-…', username, password, protocolVersion:5 → fallback 4 if broker refuses})`. Default protocol **v4 (3.1.1)** for broadest compatibility (aedes, Mosquitto, EMQX). Subscribe `topics.tenantWildcard(tenant)` QoS1 on each `connect` event. Token refresh: assign `client.options.password = newToken` on `onIdTokenChanged`; never `end()` for refresh.
- **Rationale**: docs §2.1, §2.6; aedes (dev cloud broker) supports 3.1.1 reliably.
- **Alternatives**: one subscription per hub/device — violates "subscribe once"; `clean:false` — docs forbid for app.
- **Browser import**: `import mqtt from 'mqtt'` (v5 ships ESM browser build); Vite `define: { global: 'globalThis' }` only if needed.

## R4 Seq dedupe and reboot
- **Decision**: `SeqGate.accept(topic, seq, ts)`: accept when no history, `seq > lastSeq`, or `ts > lastTs + 60_000` (hub reboot reset); otherwise drop. Keyed by full topic string. Cleared on sign-out only (not on reconnect — retained replay of identical seq is correctly dropped as dup, store already holds it).
- **Rationale**: docs §2.3; spec §9.
- **Alternatives**: dedupe by payload hash — misses reorder.

## R5 clockOffset
- **Decision**: samples `status.ts − Date.now()` from non-retained `status` (heartbeat every 30 s); first retained `status` gives a provisional value until a live sample arrives; keep last 5, use median; `hubNow() = Date.now() + clockOffset`. Per hub (v1: one per site).
- **Rationale**: retained status may be up to 30 s old (heartbeat), which would skew countdowns; docs §2.4 asks median of 5.
- **Alternatives**: NTP-style round-trip via `cmd` — extra traffic; also derive from `state.ts` — same retained-staleness issue.

## R6 Optimistic set + rollback
- **Decision**: `PendingTracker` keyed `deviceId/key`; `setValues(deviceId, values)` registers pending for each key (replacing an older pending for the same key and restarting its timer), publishes `SetCommand` QoS1 to `topics.set`. Incoming `DeviceState` clears keys whose value equals pending (normalize: boolean strict, numeric `Math.abs(a-b) < 10^-precision`, enum/text strict). Timer `SET_CONFIRM_TIMEOUT_MS` → remove + `toast.timeout(deviceName)`. `HubEvent set.rejected` → remove all keys of that device + error toast. Device or hub offline → `setValues` refuses (UI disables toggle).
- **Rationale**: D-05, constitution V, spec §9 "3 tiles independent".
- **Alternatives**: mutate confirmed values optimistically and restore — risks showing wrong state after race.

## R7 Command correlation
- **Decision**: `pending: Map<CommandId, {resolve, reject, timer}>`; ack routed by `id`; timeout `CMD_ACK_TIMEOUT_MS` → `HubTimeoutError` → caller shows "Hub không phản hồi"-type toast from i18n (artboard string at implement time). `pairing.start` resolves with `result.expiresAt` but UI countdown always reads retained `pairing`.
- **Rationale**: docs §2.2.

## R8 ConfigSource
- **Decision**: interface `ConfigSource.start(tenantId) / stop()` writes into the `config` store (`sites, roomsBySite, hubs, devices, rules, scenes, layouts, events`, plus `loaded` flags and `fromCache`). Cloud: `onSnapshot` per collection with `includeMetadataChanges:false`, rooms listener per site, each doc `safeParse`d with the shared schema. Firestore `Timestamp` values (e.g. hub-written `events.expireAt`, 001-OQ-4) are converted to epoch ms before parsing. LAN: `fetch('/api/config', {headers: {'If-None-Match': etag}})` every 30 s (+ on `visibilitychange` visible), 304 → no-op; maps the snapshot arrays into the same store.
- **Rationale**: constitution IV exception; identical consumer API for both builds.
- **Alternatives**: separate LAN stores — duplicates selectors.

## R9 Firebase emulator wiring
- **Decision**: `lib/firebase.ts` `initializeApp({projectId: VITE_FIREBASE_PROJECT_ID ('demo-devicenet'), apiKey: VITE_FIREBASE_API_KEY ('demo-key'), authDomain})`; if `VITE_USE_EMULATOR==='1'`: `connectAuthEmulator(auth, VITE_AUTH_EMULATOR_URL, {disableWarnings:true})`, `initializeFirestore(app, {localCache: persistentLocalCache({tabManager: persistentMultipleTabManager()})})` then `connectFirestoreEmulator(db, host, 8085)`. Google sign-in on the Auth emulator works with `signInWithPopup` (emulator account chooser) — no real OAuth client required.
- **Rationale**: dev-env.md; `demo-` project needs no credentials.

## R10 REST client
- **Decision**: `openapi-typescript` generates `src/lib/api.gen.ts` from `specs/000-shared-contracts/contracts/api.openapi.yaml` (script `gen:api`, output committed); `openapi-fetch` client with middleware adding `Authorization: Bearer <idToken>`; errors mapped from `{error:{code,message}}`. Used through TanStack Query mutations.
- **Rationale**: spec §3 "OpenAPI client sinh từ api.openapi.yaml"; generated, not hand-redefined (constitution II).
- **Alternatives**: hand-written fetch types — violates II.

## R11 Components on shadcn primitives
- **Decision**: `components/ui/*` = shadcn-generated Radix wrappers kept behaviour-only (strip default styles); `components/dn/*` = `DeviceNet.*` look via token Tailwind classes, variants via `cva`. Reference `design/ds/devicenet/components/bundle.{js,css}` for props/variants; never import it. Sheet = Radix Dialog bottom-anchored with drag-handle visual only.
- **Rationale**: constitution tech constraints; a11y from Radix.
- **Alternatives**: `vaul` drawer — extra dep, swipe physics not required by design.

## R12 Tokens pipeline
- **Decision**: `scripts/gen-tokens.ts` reads `design/ds/devicenet/tokens.json` → `src/styles/tokens.css` with `@theme { --color-bg: …; --spacing-…; --radius-…; }` (light) and `.dark { … }` overrides; numbers/sizes from `size` group. Output committed; test asserts regenerated output equals committed file.
- **Rationale**: tokens change with Design; regeneration avoids manual drift; no pixel values in plan.

## R13 Test approach for transport
- **Decision**: `test/aedes.ts` starts `aedes` + `net.createServer` on port 0 per test file; `MqttClient` takes its URL (`mqtt://127.0.0.1:<port>`) so the same code runs over TCP in node; a `fakeHub` helper publishes retained `status/state/pairing` and answers `cmd` with `ack`. Timeouts: units use `vi.useFakeTimers()`; integration overrides timeouts via constructor option (defaults = shared constants) to keep tests < 1 s.
- **Rationale**: spec §7 names aedes; fake timers + real sockets don't mix well.

## R14 LAN build specifics
- **Decision**: `vite build --mode lan` → `dist-lan/` with `base: '/'`; MQTT URL `ws://${location.hostname}:9001` (spec §5 says `location.host`, but that includes `:8080`); no login, `session` filled from `/api/config` (`tenantId`, `hubId`); `by: "lan"` on set/cmd; `writes = null`.
- **Rationale**: spec §5, hub-lan.openapi.yaml.

## R15 Bundle budget
- **Decision**: route-level `lazy()` for S-30, S-20 chart, S-10 QR; firebase in its own chunk imported by `transport/cloud`; check with `vite build` + `rollup-plugin-visualizer` (dev only) in P8.
