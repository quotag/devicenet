---
description: "Task list for 002 – Frontend PWA (apps/web)"
---

# Tasks: 002 – Frontend PWA (`apps/web`)

**Input**: [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md), [data-model.md](./data-model.md), [contracts/README.md](./contracts/README.md), [quickstart.md](./quickstart.md), [open-questions.md](./open-questions.md)
**Tests**: required by constitution VI and spec §7, §9 (transport with aedes; RuleEditor validation). No long Playwright e2e.

## Conventions

- Format: `- [ ] T### [P?] [US??] [model:…] [M-Local?] description — files`. `[P]` = no dependency on other open tasks **in the same batch** (different files). `[USxx]` = spec user story (US-01…US-16).
- Paths are relative to `apps/web/` unless they start with `specs/`, `design/` or `packages/`.
- **Batch = one agent.** It owns only the files listed under "Owns"; anything else is read-only. A batch ends with its **Verify** command, which must pass before the batch is marked done.
- **Before any batch**: `pnpm install` and `pnpm --filter @devicenet/shared build` (web resolves `@devicenet/shared` via `dist/`). Types/constants/helpers come **only** from `@devicenet/shared`; never redefine.
- **UI batches (constitution VIII)**: the orchestrator checks the canvas version (`design/README.md`) before the batch starts. The agent reads the listed artboards and copies layout, components, strings (into `src/i18n/vi.ts`) and tokens from them. No artboard or unreadable → stop, add a row to `specs/002-frontend-pwa/open-questions.md`. No pixel values in code except token classes.
- Strings: every UI string goes in `src/i18n/vi.ts`. A UI batch may **append** keys under its own namespace (`vi.home`, `vi.s10`, …) and must not edit other namespaces.
- Never edit `spec.md`, `specs/000-*`, `design/`, `.specify/memory/`, root workspace files, `packages/shared`.

## Batch map

| Batch | Title | Model (lead) | Depends on | Parallel group | M-Local |
|---|---|---|---|---|---|
| B01 | Scaffold `apps/web` | sonnet | – | G0 | ✓ |
| B02 | Tokens, theme, fonts, icons | haiku | B01 | G1 | ✓ |
| B03 | i18n base, format, deviceView | haiku | B01 | G1 | ✓ |
| B04 | Stores, firebase, api client, paths | sonnet | B01 | G1 | ✓ |
| B05 | Transport pure core (SeqGate, clock, pending) | opus | B01 | G1 | ✓ |
| B06 | MqttClient, inbound pipeline, HubCommands | opus | B04, B05 | G2 | ✓ |
| B07 | ConfigSources (Firestore + LAN) + writes | sonnet | B04 | G2 | ✓ |
| B08 | DS components 1 | sonnet | B02, B03 | G2 | ✓ |
| B09 | DS components 2 | sonnet | B02, B03 | G2 | ✓ |
| B10 | Transport factory, hooks, fake transport | opus | B06, B07 | G3 | ✓ |
| B11 | App shell, router, S-00, tab stubs | sonnet | B08, B09, B10 | G4 | ✓ |
| B12 | S-10 Add hub | sonnet | B11 | G5 | ✓ |
| B13 | S-11 Pairing + naming (+SH-5 newRoom) | sonnet | B11 | G5 | ✓ |
| B14 | S-01 Home + SH-2 + toasts | sonnet | B11 | G5 | ✓ |
| B15 | S-20 Device detail (basic) | sonnet | B11 | G5 | ✓ |
| B16 | LAN build + M-Local wrap-up | sonnet | B12–B15 | G6 | ✓ |
| B17 | S-02 Automate | sonnet | B16 | G7 | |
| B18 | RuleEditor state + validation | opus | B16 | G7 | |
| B19 | S-30 RuleEditor UI | sonnet | B17, B18 | G8 | |
| B20 | S-03 Me, hub detail, history, S-40 | sonnet | B16 | G7 | |
| B21 | Sheets SH-1, SH-3, SH-4, SH-5, SH-6 | sonnet | B17, B20 | G8 | |
| B22 | Arrange mode | opus | B16 | G7 | |
| B23 | S-20 full: history + chart | sonnet | B16 | G7 | |
| B24 | Desktop ≥ 900 | sonnet | B19, B21, B22 | G9 | |
| B25 | PWA polish, bundle, optional smoke | sonnet | B24 | G10 | |

Batches in the same parallel group can run concurrently (disjoint file ownership). Groups run in order G0 → G10.

---

## Phase 1: Setup

### B01 — Scaffold `apps/web` · [model:sonnet] · M-Local
Owns: `apps/web/{package.json,tsconfig.json,vite.config.ts,vitest.config.ts,index.html,components.json,.env.*}`, `src/main.tsx`, `src/env.ts`, `src/vite-env.d.ts`, `test/setup.ts`, `test/architecture.test.ts`.

- [X] T001 [model:sonnet] [M-Local] Create `package.json` (name `web`, `type: module`, deps per plan Technical Context incl. `@devicenet/shared: workspace:*`) with scripts `dev`, `build`, `build:lan` (`vite build --mode lan --outDir dist-lan`), `test` (`vitest run`), `typecheck` (`tsc --noEmit`), `gen:tokens`, `gen:api` — `package.json`
- [X] T002 [model:haiku] [M-Local] `tsconfig.json` extending `../../tsconfig.base.json` (lib DOM, jsx react-jsx, `@/*` → `src/*`), `src/vite-env.d.ts` typing all `VITE_*` vars and `__APP_VERSION__` — `tsconfig.json`, `src/vite-env.d.ts`
- [X] T003 [model:sonnet] [M-Local] `vite.config.ts`: React plugin, `@tailwindcss/vite`, alias `@`, `define.__APP_VERSION__`, port 5173; `vitest.config.ts` default env jsdom, `test/setup.ts` (Testing Library jest-dom) — `vite.config.ts`, `vitest.config.ts`, `test/setup.ts`
- [X] T004 [P] [model:haiku] [M-Local] Env files per quickstart: `.env.development` (cloud + emulator, `VITE_MQTT_URL=ws://localhost:8084/mqtt`), `.env.lan` (`VITE_MODE=lan`), `.env.example` documenting each var — `.env.development`, `.env.lan`, `.env.example`
- [X] T005 [model:sonnet] [M-Local] `src/env.ts`: Zod-parse `import.meta.env` into a typed `env` object (`mode: "cloud"|"lan"`, emulator flags, URLs); cloud requires api/mqtt/firebase vars; `index.html` + `src/main.tsx` render placeholder root — `src/env.ts`, `index.html`, `src/main.tsx`
- [X] T006 [model:haiku] [M-Local] `npx shadcn init` (components.json, no default theme styles, aliases `@/components/ui`) — `components.json`
- [X] T007 [model:sonnet] [M-Local] Architecture test: scans `src/**` and fails if `mqtt` or `firebase/firestore` is imported outside `src/transport/`, if `setInterval` appears outside `src/transport/lan/` and `src/components/dn/CountdownRing.tsx`, or if a local `z.object(` schema duplicates a shared name (constitution II/IV) — `test/architecture.test.ts`

**Verify**: `pnpm --filter web typecheck && pnpm --filter web test && pnpm --filter web build && pnpm --filter web build:lan`

---

## Phase 2: Foundational (blocks all screens)

### B02 — Tokens, theme, fonts, icons · [model:haiku] · M-Local · G1
Owns: `scripts/gen-tokens.ts`, `src/styles/*`, `src/components/dn/DeviceIcon.tsx`, `src/lib/theme.ts`, tests for these.
Design refs: `design/ds/devicenet/tokens.json`, `design/dn.css`, `design/dn-icons.js`; spec §6, FR-F10 icon map.

- [X] T008 [model:sonnet] [M-Local] `scripts/gen-tokens.ts`: read `design/ds/devicenet/tokens.json` → `src/styles/tokens.css` (`@theme` light values + `.dark` overrides for color; spacing, radius, size groups); `--check` flag exits 1 if output differs — `scripts/gen-tokens.ts`, `src/styles/tokens.css`
- [X] T009 [P] [model:haiku] [M-Local] `src/styles/base.css`: import Tailwind, tokens, `@fontsource/inter` 400/500/600, body bg/text tokens, `tabular-nums` utility, `prefers-reduced-motion`; frame classes (header, tabbar, row, card, kv) rebuilt from `design/dn.css` as `@layer components` — `src/styles/base.css`
- [X] T010 [P] [model:haiku] [M-Local] `src/lib/theme.ts`: apply `light|dark|system` to `<html class="dark">`, listen to `prefers-color-scheme`, persist in localStorage (try/catch) — `src/lib/theme.ts`
- [X] T011 [P] [model:haiku] [M-Local] `DeviceIcon`: map `device.icon` values `plug, toggle-left, lightbulb, fan, thermometer, zap, radar, door-open` + `router` to lucide-react (stroke 1.75), fallback `plug`; export the 8-item picker list (labels via i18n keys) — `src/components/dn/DeviceIcon.tsx`
- [X] T012 [model:haiku] [M-Local] Tests: `gen-tokens --check` passes on committed file; theme toggles class; DeviceIcon fallback — `test/tokens.test.ts`, `src/lib/theme.test.ts`, `src/components/dn/DeviceIcon.test.tsx`

**Verify**: `pnpm --filter web gen:tokens --check && pnpm --filter web test && pnpm --filter web typecheck`

### B03 — i18n base, format, deviceView · [model:haiku] · M-Local · G1
Owns: `src/i18n/vi.ts` (namespaces `common`, `banner`, `toast`, `units`), `src/lib/format.ts`, `src/lib/deviceView.ts`, their tests, `test/fixtures/*`.

- [X] T013 [model:haiku] [M-Local] `src/i18n/vi.ts` skeleton: `as const` object with namespaces `common`, `banner`, `toast`, `units` filled from spec §8 Banner/Toast rows (verbatim, interpolations as functions) and empty namespaces `s00, s10, s11, home, s20, automate, me` for later batches — `src/i18n/vi.ts`
- [X] T014 [P] [model:sonnet] [M-Local] `format.ts`: `formatValue(prop, value)` (vi-VN decimals per `precision`, unit), `relativeTime(ts, nowMs)` ("x giây/phút/giờ trước"), `hhmm(ts, tz)` — `src/lib/format.ts`, `src/lib/format.test.ts`
- [X] T015 [P] [model:sonnet] [M-Local] `deviceView.ts` per data-model.md "View models": `toggleKey`, `primaryKey`, `secondarySensors(n=2)`, `homeDevices(devices, layout, siteId, filter)` (only `status === "active"`, layout order then `createdAt`), `foundDevices(hubId)` (`status === "new"`), `propertyGroups` — `src/lib/deviceView.ts`
- [X] T016 [model:haiku] [M-Local] Fixtures typed with shared types: TS011F `Device` (properties per 000 data-model §4) + `DeviceState`, `HubStatus`, `PairingState`, ids — `test/fixtures/index.ts`
- [X] T017 [model:sonnet] [M-Local] Tests for deviceView (status filter incl. spec §9 "new not on Home", ordering, defaults) — `src/lib/deviceView.test.ts`

**Verify**: `pnpm --filter web test && pnpm --filter web typecheck`

### B04 — Stores, firebase, api client, paths · [model:sonnet] · M-Local · G1
Owns: `src/stores/*`, `src/lib/{firebase.ts,api.ts,api.gen.ts,paths.ts}`, their tests.

- [X] T018 [model:sonnet] [M-Local] Zustand vanilla stores exactly as data-model.md (`session`, `connection`, `deviceState`, `config`, `ui`, `toast`) with typed actions and a `resetAll()` for sign-out — `src/stores/*.ts`
- [X] T019 [P] [model:sonnet] [M-Local] `lib/firebase.ts` (cloud only, dynamic-import friendly): init with `demo-devicenet` env, `initializeFirestore` with `persistentLocalCache({tabManager: persistentMultipleTabManager()})`, emulator connect when `VITE_USE_EMULATOR=1` (Auth 9099, Firestore 8085) per research R9 — `src/lib/firebase.ts`
- [X] T020 [P] [model:haiku] [M-Local] `gen:api` script with `openapi-typescript specs/000-shared-contracts/contracts/api.openapi.yaml -o src/lib/api.gen.ts`; commit output — `src/lib/api.gen.ts`
- [X] T021 [model:sonnet] [M-Local] `lib/api.ts`: `openapi-fetch` client on `VITE_API_URL`, auth middleware (Bearer ID token getter injected), `ApiError {status, code, message}` from `{error:{code,message}}` — `src/lib/api.ts`
- [X] T022 [P] [model:haiku] [M-Local] `lib/paths.ts`: Firestore path helpers under `tenants/{t}` (sites, rooms, hubs, devices, rules, scenes, layouts, events, members) — `src/lib/paths.ts`
- [X] T023 [model:sonnet] [M-Local] Tests: store actions + reset; api error mapping with mocked fetch — `src/stores/stores.test.ts`, `src/lib/api.test.ts`

**Verify**: `pnpm --filter web test && pnpm --filter web typecheck`

### B05 — Transport pure core · [model:opus] · M-Local · G1
Owns: `src/transport/{SeqGate.ts,clockOffset.ts,PendingTracker.ts,errors.ts}` + tests. No store imports (callbacks only).
Refs: docs/realtime-and-events.md §2.2–2.4; research R4–R6.

- [X] T024 [model:opus] [M-Local] `SeqGate.accept(topic, seq, ts)`: accept first, `seq > last`, or `ts > lastTs + 60_000`; `reset()` — `src/transport/SeqGate.ts`
- [X] T025 [model:opus] [M-Local] `ClockOffset`: `addSample(hubTs, localNow, retained)`; retained only as provisional when no live sample; median of last 5 live; `now()` — `src/transport/clockOffset.ts`
- [X] T026 [model:opus] [M-Local] `PendingTracker`: `register(deviceId, values, props)` per key (replace + restart timer), `onState(deviceState)` clears matching keys (boolean strict, numeric within `10^-precision`, enum/text strict), `onRejected(deviceId)`, timeout `SET_CONFIRM_TIMEOUT_MS` (overridable) → `onTimeout(deviceId, keys)`; emits snapshot for the store — `src/transport/PendingTracker.ts`
- [X] T027 [P] [model:sonnet] [M-Local] `errors.ts`: `HubTimeoutError`, `HubOfflineError`, `CommandFailedError(ack)` — `src/transport/errors.ts`
- [X] T028 [model:opus] [M-Local] Unit tests (fake timers): duplicate/out-of-order/reboot-by-ts; median + retained ignored; 3 rapid toggles on 3 devices → independent clear/rollback (spec §9); same-key re-register restarts timer; rejected clears — `src/transport/*.test.ts`

**Verify**: `pnpm --filter web test -- src/transport && pnpm --filter web typecheck`

### B06 — MqttClient, inbound pipeline, HubCommands · [model:opus] · M-Local · G2
Owns: `src/transport/{MqttClient.ts,inbound.ts,HubCommands.ts}`, `test/aedes.ts`, `test/fakeHub.ts`, tests.
Refs: docs §2.1, §2.2, §2.6, §2.7; research R3, R6, R7, R13.

- [X] T029 [model:opus] [M-Local] `MqttClient`: wraps mqtt.js 5 (`clean:true`, `keepalive:30`, backoff 1→10 s, `clientId web-<uid|lan>-<ulid>`, protocol 3.1.1); subscribe `topics.tenantWildcard(t)` QoS1 on **every** `connect`; `setPassword(token)` mutates options without disconnect; status → `connection.mqtt`; `publish(kind, topic, payload)` uses `topicPolicy` — `src/transport/MqttClient.ts`
- [X] T030 [model:opus] [M-Local] `inbound.ts`: `parseTopic` → shared schema per kind → `SeqGate` → dispatch (`HubStatus` → connection + ClockOffset, `DeviceState` → deviceState + PendingTracker, empty retained state → remove, `PairingState`, `RunProgress`, `HubEvent` (`set.rejected` → PendingTracker + toast), `CommandAck` → HubCommands); invalid → `console.warn` + drop; ignore `set`/`cmd` — `src/transport/inbound.ts`
- [X] T031 [model:opus] [M-Local] `HubCommands`: `sendCommand(hubId, cmd)` → `CommandEnvelope` (`cmd_<ULID>`, `sentAt`, `by`), resolve on ack, reject `HubTimeoutError` at `CMD_ACK_TIMEOUT_MS` (overridable), ack `ok:false` → `CommandFailedError`; `setValues(deviceId, values)` validates with `validateValue`/`isWritable`, refuses when hub/device offline (`HubOfflineError`), registers pending, publishes `SetCommand` — `src/transport/HubCommands.ts`
- [X] T032 [P] [model:sonnet] [M-Local] `test/aedes.ts` (aedes + `net` server on port 0, start/stop) and `test/fakeHub.ts` (publishes retained status/state/pairing with seq, answers `cmd` with ack, optional echo of `set` as new `state`) — `test/aedes.ts`, `test/fakeHub.ts`
- [X] T033 [model:opus] [M-Local] Integration tests (node env): retained replay fills stores; subscribe once per connect and again after broker restart; malformed payload dropped with warn; toggle round-trip clears pending; no echo → rollback + toast; `setPassword` keeps connection (spec §9); pairing.start ack + retained pairing — `src/transport/mqtt.int.test.ts`

**Verify**: `pnpm --filter web test -- src/transport && pnpm --filter web typecheck`

### B07 — ConfigSources + writes · [model:sonnet] · M-Local · G2
Owns: `src/transport/ConfigSource.ts`, `src/transport/cloud/*`, `src/transport/lan/*`, `src/transport/writes.ts`, tests.
Refs: research R8, R14; firestore.ts/.rules writer matrix; hub-lan.openapi.yaml `/api/config`.

- [X] T034 [model:opus] [M-Local] `ConfigSource` interface (`start(tenantId)`, `stop()`, `ready: Promise`) writing to `config` store; doc → `safeParse` with shared schema, convert Firestore `Timestamp` → epoch ms first, invalid → warn + skip — `src/transport/ConfigSource.ts`
- [X] T035 [model:sonnet] [M-Local] `FirestoreConfigSource`: `onSnapshot` for `sites`, `rooms` per site (re-subscribe on site changes), `hubs`, `devices` (`includeMetadataChanges:false`), sets `loaded`/`fromCache` — `src/transport/cloud/FirestoreConfigSource.ts`
- [X] T036 [model:sonnet] [M-Local] `LanConfigSource`: `GET /api/config` with `If-None-Match` every 30 s and on `visibilitychange` visible; 304 no-op; maps arrays into same store; exposes `tenantId`, `hubId` — `src/transport/lan/LanConfigSource.ts`
- [X] T037 [model:sonnet] [M-Local] `writes.ts` (cloud): `updateDevicePresentation(id, {name, roomId, icon, primaryProperty, status?:"active"})` (only fields allowed by rules; `updatedAt`), `createRoom(siteId, name)` (`room_<ULID>`, `order`), `createSite(name, tz)`, `renameHub(hubId, name, siteId?)` — `src/transport/writes.ts`
- [X] T038 [model:sonnet] [M-Local] Tests: LAN poll/ETag with mocked fetch + fake timers; Firestore source with a mocked `onSnapshot` adapter (bad doc skipped, Timestamp converted); writes produce rule-compliant field sets — `src/transport/config.test.ts`

**Verify**: `pnpm --filter web test -- src/transport && pnpm --filter web typecheck`

### B08 — DS components 1 · [model:sonnet] · M-Local · G2
Owns: `src/components/ui/{button,switch,checkbox}.tsx` (shadcn), `src/components/dn/{Button,Chip,Switch,Card,Badge,Input,Banner,StatusBanner,Skeleton,Row}.tsx` + tests.
Design refs: `design/ds/devicenet/components/bundle.{js,css}`, `design/S01-Home.dc.html`, `design/S01-Offline.dc.html`, `design/S10-NhapMa.dc.html`; spec §6.

- [X] T039 [P] [model:sonnet] [M-Local] `Button` (variants primary/secondary/ghost/danger, loading state) — `src/components/dn/Button.tsx`
- [X] T040 [P] [model:sonnet] [M-Local] `Chip` (selected, add/dashed, disabled) and `Badge` (OK/Lỗi/Mới/Sẽ lỗi/syncing variants per bundle) — `src/components/dn/Chip.tsx`, `src/components/dn/Badge.tsx`
- [X] T041 [P] [model:sonnet] [M-Local] `Switch` on Radix (pending spinner, disabled, ≥ 44 touch) — `src/components/ui/switch.tsx`, `src/components/dn/Switch.tsx`
- [X] T042 [P] [model:sonnet] [M-Local] `Card`, `Row` (list row with icon/label/hint/chevron), `Skeleton` — `src/components/dn/{Card,Row,Skeleton}.tsx`
- [X] T043 [P] [model:sonnet] [M-Local] `Input` (label, hint, error) — `src/components/dn/Input.tsx`
- [X] T044 [model:sonnet] [M-Local] `Banner` + `StatusBanner` (modes offline/lan/reconnecting/saving per `S01-Offline` prop `mode`; text passed in) — `src/components/dn/{Banner,StatusBanner}.tsx`
- [X] T045 [model:sonnet] [M-Local] Component tests: roles/aria, disabled, pending — `src/components/dn/ds1.test.tsx`

**Verify**: `pnpm --filter web test -- src/components && pnpm --filter web typecheck`

### B09 — DS components 2 · [model:sonnet] · M-Local · G2
Owns: `src/components/ui/{dialog,toggle-group,radio-group,slider}.tsx`, `src/components/dn/{Sheet,SegmentedTabs,Stepper,Toast,CodeInput,CountdownRing,DeviceTile,Header,TabBar,Slider}.tsx` + tests.
Design refs: bundle.{js,css}, `design/S01-Home.dc.html`, `design/S01-Toast.dc.html`, `design/S10-NhapMa.dc.html`, `design/S11-TimThietBi.dc.html`.

- [X] T046 [P] [model:sonnet] [M-Local] `Sheet` (Radix Dialog bottom; `asDialog` prop for ≥ 900 later), `SegmentedTabs` (ToggleGroup), `Slider` — `src/components/dn/{Sheet,SegmentedTabs,Slider}.tsx`
- [X] T047 [P] [model:sonnet] [M-Local] `Stepper` (3 steps, done ✓ / current) — `src/components/dn/Stepper.tsx`
- [X] T048 [P] [model:sonnet] [M-Local] `Toast` host reading `toast` store: one at a time, `role="status"`, auto-hide 4 s / 8 s with action (FR-F14) — `src/components/dn/Toast.tsx`
- [X] T049 [P] [model:sonnet] [M-Local] `CodeInput` 8 cells: auto-advance, paste whole code, accept only `[A-HJ-NP-Z2-9]`, uppercase, error shake state (FR-F04) — `src/components/dn/CodeInput.tsx`
- [X] T050 [P] [model:sonnet] [M-Local] `CountdownRing(remainingMs, totalMs)` (render-only repaint every 250 ms via rAF/interval — allowed exception) — `src/components/dn/CountdownRing.tsx`
- [X] T051 [model:sonnet] [M-Local] `DeviceTile` presentational: sizes 1×1/2×1, states on/off/pending/offline/highlight (arranging later), rows per FR-F01; props only (no hooks) — `src/components/dn/DeviceTile.tsx`
- [X] T052 [model:sonnet] [M-Local] `Header`, `TabBar` (Home/Automate/Me, red dot props) — `src/components/dn/{Header,TabBar}.tsx`
- [X] T053 [model:sonnet] [M-Local] Tests: CodeInput filtering/paste; Toast auto-hide; DeviceTile state rendering + toggle a11y label — `src/components/dn/ds2.test.tsx`

**Verify**: `pnpm --filter web test -- src/components && pnpm --filter web typecheck`

### B10 — Transport factory, hooks, fake transport · [model:opus] · M-Local · G3
Owns: `src/transport/{index.ts,hooks.ts,TransportProvider.tsx}`, `test/fakeTransport.ts`, tests.
Refs: contracts/README.md (hook table), plan decision 1.

- [X] T054 [model:opus] [M-Local] `createTransport(mode, session)`: cloud → dynamic import firebase + `FirestoreConfigSource` + `writes`; lan → `LanConfigSource`, `writes = null`, MQTT `ws://${location.hostname}:9001`, `by:"lan"`; wires MqttClient/inbound/HubCommands/stores; `dispose()` — `src/transport/index.ts`
- [X] T055 [model:opus] [M-Local] Hooks per contracts/README.md (`useDevices`, `useDevice`, `useDeviceState` merged with pending, `useSetValues`, `useSendCommand`, `useHub`, `useHubStatus`, `usePairing` with `remainingMs` via hub clock, `useConnection`, `useSites`, `useRooms`, `useConfigWrites`, `useHubNow`) with per-id selectors — `src/transport/hooks.ts`
- [X] T056 [model:sonnet] [M-Local] `TransportProvider` (context holding the Transport instance; created after session ready) — `src/transport/TransportProvider.tsx`
- [X] T057 [model:sonnet] [M-Local] `test/fakeTransport.ts`: in-memory Transport implementing the same API (seed config/state, record commands/sets, simulate ack/timeout) for screen tests — `test/fakeTransport.ts`
- [X] T058 [model:opus] [M-Local] Tests: `useDeviceState` re-renders only for its id; pending merge; `usePairing` countdown with clock offset from retained pairing (spec §9); LAN bundle check — `src/transport/hooks.test.tsx`

**Verify**: `pnpm --filter web test && pnpm --filter web typecheck && pnpm --filter web build:lan` (then assert `dist-lan` contains no `firebase` chunk: `! grep -rl "firestore" apps/web/dist-lan/assets`)

### B11 — App shell, router, S-00, tab stubs · [model:sonnet] · M-Local · G4
Owns: `src/app/*`, `src/features/auth/*`, `src/features/automate/AutomateStub.tsx`, `src/features/me/MeMinimal.tsx`, `vi.s00`, tests.
Artboards: `design/Main.dc.html` (S-00), `design/S02-Trong.dc.html` (prop `tab`), `design/S03-Me.dc.html` (prop `state`); spec FR-F00, OQ-02.

- [X] T059 [US01] [model:sonnet] [M-Local] Router (code-based) with routes from plan table, `TabLayout`, `SheetHost` (renders `ui.sheet`), guards: cloud signed-out → `/login`; no hub → `/onboarding/hub`; LAN → no `/login`, S-10/S-11 → `/home` — `src/app/{router.tsx,TabLayout.tsx,SheetHost.tsx,guards.ts}`
- [X] T060 [US01] [model:sonnet] [M-Local] `providers.tsx` + `main.tsx`: theme, QueryClient, session boot (cloud `onAuthStateChanged`/`onIdTokenChanged` → session + `mqtt.setPassword`; LAN boot from `LanConfigSource`), TransportProvider, Toast — `src/app/providers.tsx`, `src/main.tsx`
- [X] T061 [US01] [model:sonnet] [M-Local] Session service: sign-in popup / redirect (iOS standalone), bootstrap when claim `tenant` missing (`POST /v1/tenants/bootstrap {timezone}` → `getIdToken(true)`), sign-out (signOut, terminate + `clearIndexedDbPersistence`, transport dispose, `resetAll`) — `src/features/auth/session.ts`
- [X] T062 [US01] [model:sonnet] [M-Local] S-00 screen per `Main.dc.html` (default, button loading, error toast); strings → `vi.s00` — `src/features/auth/LoginScreen.tsx`, `src/i18n/vi.ts`
- [X] T063 [P] [US08] [model:sonnet] [M-Local] Automate tab stub = `S02-Trong` empty state, static, CTAs inert (OQ-02) — `src/features/automate/AutomateStub.tsx`
- [X] T064 [P] [US15] [model:sonnet] [M-Local] Me minimal = `S03-Me` account card, Hub row with online state (`useHubStatus`), "Đăng xuất" (OQ-02) — `src/features/me/MeMinimal.tsx`
- [X] T065 [US01] [model:sonnet] [M-Local] Tests: guard redirects (no session, no hub, LAN); bootstrap called once when claim missing then token refreshed; sign-out resets stores — `src/app/app.test.tsx`, `src/features/auth/session.test.ts`

**Verify**: `pnpm --filter web test && pnpm --filter web typecheck && pnpm --filter web build`

---

## Phase 3: M-Local user stories (B12–B15 run in parallel, G5)

### B12 — S-10 Add hub · [US02] · [model:sonnet] · M-Local
Owns: `src/features/onboarding/hub/*`, `vi.s10`.
Artboards: `design/S10-CaiAgent.dc.html`, `design/S10-NhapMa.dc.html`, `design/S10-MaSai.dc.html`, `design/S10-KetNoi.dc.html`; spec FR-F04, data-model 000 §3.1.

- [X] T066 [US02] [model:sonnet] [M-Local] Flow container `/onboarding/hub` with `Stepper` and step state machine (install → code → connect) — `src/features/onboarding/hub/AddHubFlow.tsx`
- [X] T067 [P] [US02] [model:sonnet] [M-Local] Step 1 "Cài agent": SegmentedTabs Windows/Linux, command block + `navigator.clipboard` copy, "Tôi đã cài", "Xem hướng dẫn chi tiết" — `src/features/onboarding/hub/StepInstall.tsx`
- [X] T068 [US02] [model:sonnet] [M-Local] Step 2 "Nhập mã": `CodeInput`, QR button disabled (OQ-05), "Kết nối" → `POST /v1/hubs/claim {code, siteId, name:"Hub {site}"}` via Query mutation; 400 → `S10-MaSai` state; 409 → reset explanation — `src/features/onboarding/hub/StepCode.tsx`
- [X] T069 [US02] [model:sonnet] [M-Local] Step 3 "Kết nối": status lines confirming → waiting → online when Firestore `hubs/{id}.online` OR MQTT `status.online`; > 60 s hint; hub name + site picker (with "Site mới" → `createSite`) → `renameHub`; "Hoàn tất" → `/home`, first time "Thêm thiết bị ngay" → S-11 (OQ-09) — `src/features/onboarding/hub/StepConnect.tsx`
- [X] T070 [P] [US02] [model:haiku] [M-Local] `vi.s10` strings verbatim from the four artboards — `src/i18n/vi.ts`
- [X] T071 [US02] [model:sonnet] [M-Local] Tests (fakeTransport + mocked api): invalid code → error state; success → online via MQTT status first; 409 path — `src/features/onboarding/hub/AddHub.test.tsx`

**Verify**: `pnpm --filter web test -- src/features/onboarding && pnpm --filter web typecheck`

### B13 — S-11 Pairing + naming · [US03] · [model:sonnet] · M-Local
Owns: `src/features/onboarding/device/*`, `src/features/me/sheets/RoomSheet.tsx` (newRoom mode only), `vi.s11`, `vi.sh5`.
Artboards: `design/S11-TimThietBi.dc.html`, `design/S11-DatTen.dc.html`, `design/S11-HetGio.dc.html`, `design/SH5-SiteRoom.dc.html` (mode `newRoom`); spec FR-F05, FR-F12, 000 §3.2.

- [X] T072 [US03] [model:sonnet] [M-Local] Flow `/onboarding/device?step=`: Stepper with step 1 auto-done ✓ (one hub per site); hub offline → block with banner + "Đến mục Hub trong Me" — `src/features/onboarding/device/AddDeviceFlow.tsx`
- [X] T073 [US03] [model:sonnet] [M-Local] Step 2 Find: on mount `pairing.start {seconds:120}` unless retained pairing already active; `CountdownRing` from `usePairing`; `FoundDeviceCard` list from `foundDevices(hubId)`; "Tiếp tục với {n} thiết bị"; leave/unmount → `pairing.stop`; ack timeout → toast (OQ-10) — `src/features/onboarding/device/StepFind.tsx`, `FoundDeviceCard.tsx`
- [X] T074 [US03] [model:sonnet] [M-Local] Timeout state per `S11-HetGio` ("Tìm lại" restarts) — `src/features/onboarding/device/StepFind.tsx`
- [X] T075 [US03] [model:sonnet] [M-Local] Step 3 Name: per-device card (name default model, room chips + "Room mới", icon picker 8, primary property radio among numeric sensors with current value) → `updateDevicePresentation({…, status:"active"})` + `device.rename`; "Lưu tất cả" → `/home` with `ui.highlight` 2 s — `src/features/onboarding/device/StepName.tsx`, `NameDeviceCard.tsx`
- [X] T076 [P] [US07] [model:sonnet] [M-Local] SH-5 `newRoom` sheet (Input, disabled when empty) → `createRoom` (OQ-04); opened via `ui.sheet` — `src/features/me/sheets/RoomSheet.tsx`
- [X] T077 [P] [US03] [model:haiku] [M-Local] `vi.s11` + `vi.sh5` (newRoom strings) verbatim from artboards — `src/i18n/vi.ts`
- [X] T078 [US03] [model:sonnet] [M-Local] Tests: opening with retained active pairing counts down correctly and does not re-send start (spec §9); unmount sends stop; save writes `status:"active"` — `src/features/onboarding/device/AddDevice.test.tsx`

**Verify**: `pnpm --filter web test -- src/features && pnpm --filter web typecheck`

### B14 — S-01 Home + SH-2 + toasts · [US04/US05/US15] · [model:sonnet] · M-Local
Owns: `src/features/home/*` (except arrange), `vi.home`, `vi.sh2`.
Artboards: `design/S01-Home.dc.html`, `design/S01-Offline.dc.html` (mode), `design/S01-Trong.dc.html` (state), `design/S01-Toast.dc.html` (kind), `design/SH2-MenuThem.dc.html`; spec FR-F01, FR-F09 (SH-2 Home), FR-F14.

- [X] T079 [US04] [model:sonnet] [M-Local] `HomeScreen`: header (site name, + → SH-2), StatusBanner priority hub offline > LAN > reconnecting with strings from `vi.banner` — `src/features/home/HomeScreen.tsx`
- [X] T080 [US07] [model:sonnet] [M-Local] `RoomChips`: "Tất cả" + rooms by `order` + add chip (→ SH-5 newRoom); sets `ui.filter` (long-press edit post-M-Local) — `src/features/home/RoomChips.tsx`
- [X] T081 [US04] [model:sonnet] [M-Local] `DeviceGrid` + connected `HomeTile` (hooks → `DeviceTile`): `homeDevices`, 2 cols, 2×1 span from layout, highlight from `ui.highlight`, body tap → `/device/$id` — `src/features/home/{DeviceGrid,HomeTile}.tsx`
- [X] T082 [US05] [model:sonnet] [M-Local] Toggle: `setValues(id, {[toggleKey]: !display})`; disabled when hub/device offline; timeout toast "Không nhận được phản hồi từ {tên}" wired from PendingTracker — `src/features/home/HomeTile.tsx`
- [X] T083 [US04] [model:sonnet] [M-Local] Empty states: no devices (CTA → S-11), room empty, loading skeleton ×4 (per `S01-Trong`) — `src/features/home/HomeEmpty.tsx`
- [X] T084 [P] [US04] [model:sonnet] [M-Local] SH-2 Home variant sheet: Thêm thiết bị → S-11, Thêm room → SH-5 newRoom, Thêm hub → S-10, Sắp xếp tile (disabled until B22) — `src/features/home/AddMenuSheet.tsx`
- [X] T085 [P] [US04] [model:haiku] [M-Local] `vi.home` + `vi.sh2` verbatim from artboards — `src/i18n/vi.ts`
- [X] T086 [US05] [model:sonnet] [M-Local] Tests: toggle → pending → confirmed; no state 3 s → rollback + toast; 3 tiles independent; `status:"new"` device not shown; banners by mode — `src/features/home/Home.test.tsx`

**Verify**: `pnpm --filter web test -- src/features/home && pnpm --filter web typecheck`

### B15 — S-20 Device detail (basic) · [US13] · [model:sonnet] · M-Local
Owns: `src/features/device/*` (except SH-3/SH-4/chart), `vi.s20`.
Artboards: `design/S20-ChiTiet.dc.html` (prop `pending`), `design/S20-Offline.dc.html`; spec FR-F06.

- [X] T087 [US13] [model:sonnet] [M-Local] `DeviceDetailScreen`: header back + name (edit button inert until B21), hero (icon, status line, room · online · "cập nhật x trước" from `at[primary]` + hub clock, big Switch with pending) — `src/features/device/DeviceDetailScreen.tsx`
- [X] T088 [US13] [model:sonnet] [M-Local] `PropertyControl` for `category=control` && writable: binary → Switch, numeric rw → Slider + number input, enum ≤ 4 → SegmentedTabs, > 4 → select; sub-line "{key} · {access}"; via `setValues` — `src/features/device/PropertyControl.tsx`
- [X] T089 [P] [US13] [model:sonnet] [M-Local] `PropertyRow` for sensors/config (value + unit, "cập nhật x trước", stale > 10 min muted) and Technical group (driver · model, externalId, vendor, firmware, LQI, hub) — `src/features/device/{PropertyRow,TechGroup}.tsx`
- [X] T090 [US13] [model:sonnet] [M-Local] Offline variant: banner, "Thiết bị không phản hồi" card, controls disabled, "Tìm lại thiết bị" → `device.ping` (ack/timeout toast) — `src/features/device/OfflineCard.tsx`
- [X] T091 [P] [US13] [model:haiku] [M-Local] `vi.s20` verbatim from artboards — `src/i18n/vi.ts`
- [X] T092 [US13] [model:sonnet] [M-Local] Tests: groups by category; enum control choice; offline disables controls and ping sends cmd — `src/features/device/DeviceDetail.test.tsx`

**Verify**: `pnpm --filter web test -- src/features/device && pnpm --filter web typecheck`

### B16 — LAN build + M-Local wrap-up · [US12] · [model:sonnet] · M-Local · G6
Owns: LAN-specific glue in `src/app/guards.ts`, `src/features/home/HomeScreen.tsx` (LAN banner only), `test/lan.test.tsx`; may touch any file to fix integration bugs found by quickstart (note them in the commit).

- [X] T093 [US12] [model:sonnet] [M-Local] LAN boot end-to-end: session from `/api/config` (`tenantId`, `hubId`), MQTT `ws://${location.hostname}:9001`, LAN banner with IP, S-10/S-11 and Me account hidden — `src/app/guards.ts`, `src/app/providers.tsx`
- [X] T094 [US12] [model:sonnet] [M-Local] Test: LAN mode with fakeTransport shows LAN banner, toggle works, `useConfigWrites()` null — `test/lan.test.tsx`
- [X] T095 [model:haiku] [M-Local] Bundle checks: `build` and `build:lan` succeed; record gzip sizes in commit message; `dist-lan` has no firebase chunk — (no files)
- [ ] T096 [model:sonnet] [M-Local] Run quickstart Q1–Q7 against `pnpm dev` (001 stack); fix web defects; log anything blocked by 001 in `specs/002-frontend-pwa/open-questions.md` — `specs/002-frontend-pwa/open-questions.md`
- [X] T097 [model:haiku] [M-Local] Re-run architecture test + full suite; tick M-Local tasks in this file — `specs/002-frontend-pwa/tasks.md`

**Verify**: `pnpm --filter web test && pnpm --filter web typecheck && pnpm --filter web build && pnpm --filter web build:lan`

---

## Phase 4: Post-M-Local user stories

### B17 — S-02 Automate · [US08/US09/US16] · [model:sonnet] · G7
Owns: `src/features/automate/{AutomateScreen,SceneCard,RuleCard,SuggestionCard,suggestions.ts}.tsx|ts`, rules/scenes listeners in `src/transport/cloud/FirestoreConfigSource.ts` (append only), `writes.ts` (`setRuleEnabled`), `vi.automate`; replaces `AutomateStub`.
Artboards: `design/S02-Scene.dc.html`, `design/S02-Automation.dc.html`, `design/S02-Trong.dc.html`, `design/SH2-MenuThem.dc.html` (Automate); spec FR-F02.

- [X] T098 [US08] [model:sonnet] Add `rules`, `scenes` `onSnapshot` + LAN mapping; `runs` already in store — `src/transport/cloud/FirestoreConfigSource.ts`, `src/transport/lan/LanConfigSource.ts`
- [X] T099 [US08] [model:sonnet] `AutomateScreen` with SegmentedTabs Tap-to-run/Automation, + → SH-2 Automate variant — `src/features/automate/AutomateScreen.tsx`
- [X] T100 [US08] [model:sonnet] `SceneCard`: tap → `scene.run`, progress from `runs` by `runId` ("Đang chạy {done} / {total}…"), ok tick 1 s, partial/failed badge — `src/features/automate/SceneCard.tsx`
- [X] T101 [US09] [model:sonnet] `RuleCard`: name, `summarizeTrigger`, enabled Switch → `setRuleEnabled` (`rev+1`, `updatedAt`), badges OK/Lỗi/Đang đồng bộ (`appliedRev !== rev`), broken disables switch; tab red dot when any broken — `src/features/automate/RuleCard.tsx`, `src/transport/writes.ts`
- [X] T102 [US08] [model:sonnet] Empty states + `suggestions.ts` templates (spec FR-F02) → open S-30 prefilled — `src/features/automate/{SuggestionCard.tsx,suggestions.ts}`
- [X] T103 [P] [US08] [model:haiku] `vi.automate` verbatim — `src/i18n/vi.ts`
- [X] T104 [US08] [model:sonnet] Tests: scene run progress; syncing badge; broken disables switch — `src/features/automate/Automate.test.tsx`

**Verify**: `pnpm --filter web test && pnpm --filter web typecheck`

### B18 — RuleEditor state + validation · [US09/US10] · [model:opus] · G7
Owns: `src/features/automate/editor/{state.ts,validate.ts,zodVi.ts}` + tests, `vi.s30.errors`.
Refs: spec FR-F08, §9; rule.ts.

- [X] T105 [US09] [model:opus] Editor reducer: draft from new/existing/suggestion, modes rule|scene (scene hides Khi/Và nếu), trigger set, conditions add/remove + AND/OR, actions add/remove/reorder, minutes↔seconds for `for`/`delay` (D-13) — `src/features/automate/editor/state.ts`
- [X] T106 [US09] [model:opus] `validate(draft)` → `Rule`/`Scene` `safeParse` with ids/hubId/siteId/`rev`; map issues to block paths for warning borders — `src/features/automate/editor/validate.ts`
- [X] T107 [US09] [model:opus] Zod issue → Vietnamese messages map — `src/features/automate/editor/zodVi.ts`, `src/i18n/vi.ts` (`vi.s30.errors`)
- [X] T108 [US10] [model:opus] Save: `writes.saveRule/saveScene` (`rev+1`, `updatedAt`, `hubId` = site hub) and `awaitApplied(id, rev, 5000)` resolving on `appliedRev === rev` else `syncing` — `src/transport/writes.ts`, `src/features/automate/editor/save.ts`
- [X] T109 [US09] [model:opus] Tests: `changed` hides/forbids value and `for`; 3 min → 180; Save disabled until valid; scene without trigger valid; reorder — `src/features/automate/editor/editor.test.ts`

**Verify**: `pnpm --filter web test -- src/features/automate/editor && pnpm --filter web typecheck`

### B19 — S-30 RuleEditor UI · [US09/US10] · [model:sonnet] · G8
Owns: `src/features/automate/editor/*.tsx`, `vi.s30` (non-error).
Artboards: `design/S30-RuleEditor.dc.html`, `design/S30-ChuaHopLe.dc.html`, `design/S30-ChonTrigger.dc.html`; spec FR-F08.

- [X] T110 [US09] [model:sonnet] `RuleEditorScreen` (lazy route): header Hủy/title/Lưu, name + icon, `RuleBlock` Khi/Và nếu/Thì with invalid styling — `src/features/automate/editor/RuleEditorScreen.tsx`, `RuleBlock.tsx`
- [X] T111 [US09] [model:sonnet] Trigger sheet: Thiết bị (device → property → 7 ops → value/unit/binary → "Liên tục trong"), Thời gian, Mặt trời — `src/features/automate/editor/TriggerSheet.tsx`
- [X] T112 [US09] [model:sonnet] Condition + action sheets (Đặt thiết bị/Chờ/Chạy scene/Thông báo); `@dnd-kit` reorder of actions — `src/features/automate/editor/{ConditionSheet,ActionSheet,ActionList}.tsx`
- [X] T113 [US10] [model:sonnet] Footer: enable Switch (disabled before first save), "Chạy thử" → `actions.test` + inline `runs`; save banner "Đã lưu, hub đang nạp…" → back to S-02; LAN → Save disabled with tooltip — `src/features/automate/editor/EditorFooter.tsx`
- [X] T114 [P] [US09] [model:haiku] `vi.s30` verbatim — `src/i18n/vi.ts`
- [X] T115 [US09] [model:sonnet] Screen test: build a property rule end to end with fakeTransport and save — `src/features/automate/editor/RuleEditorScreen.test.tsx`

**Verify**: `pnpm --filter web test && pnpm --filter web typecheck && pnpm --filter web build`

### B20 — S-03 Me, hub detail, history, S-40 · [US12/US15/US16] · [model:sonnet] · G7
Owns: `src/features/me/*` (except `sheets/`), events + members listeners in cloud ConfigSource (append only), `writes.ts` (`setPrefs`), `vi.me`, `vi.s40`; replaces `MeMinimal`.
Artboards: `design/S03-Me.dc.html` (state, unnamed), `design/S03-ChiTietHub.dc.html` (state, confirm), `design/S03-LichSu.dc.html` (state), `design/S40-CaiDat.dc.html`; spec FR-F03.

- [X] T116 [US16] [model:sonnet] `events` listener (`ts desc`, limit 50) converting Firestore `Timestamp` fields (hub-written `expireAt`, 001-OQ-4) → epoch ms **before** `EventDoc.parse`; LAN via `/api/events` — `src/transport/cloud/FirestoreConfigSource.ts`, `src/transport/lan/LanConfigSource.ts`
- [X] T117 [US15] [model:sonnet] `MeScreen`: account card, HubRow(s), unnamed-device row → S-11 step name, Site & Room list, 5 latest EventRow, "Xem tất cả (7 ngày)" — `src/features/me/MeScreen.tsx`
- [X] T118 [US15] [model:sonnet] Hub detail: info, LAN address + Mở, versions, Đổi tên, "Gỡ hub" confirm dialog with checkbox → `DELETE /v1/hubs/{id}` — `src/features/me/HubDetailScreen.tsx`
- [X] T119 [US16] [model:sonnet] History 7 days: chips Tất cả/Chỉ lỗi, grouped by day, empty state — `src/features/me/HistoryScreen.tsx`
- [X] T120 [US12] [model:sonnet] S-40 settings: language (vi only), °C/°F, theme → local + `members/{uid}.prefs`; LAN row with `hub.lanUrl` + Mở; Thông báo "Sắp có"; Đăng xuất; no "Xóa tài khoản" (D-16); versions — `src/features/me/SettingsScreen.tsx`, `src/transport/writes.ts`
- [X] T121 [P] [US15] [model:haiku] `vi.me` + `vi.s40` verbatim — `src/i18n/vi.ts`
- [X] T122 [US16] [model:sonnet] Tests: Timestamp→ms conversion before parse; history grouping; remove hub flow — `src/features/me/Me.test.tsx`

**Verify**: `pnpm --filter web test && pnpm --filter web typecheck`

### B21 — Sheets SH-1, SH-3, SH-4, SH-5, SH-6 · [US07/US14] · [model:sonnet] · G8
Owns: `src/features/home/SiteSheet.tsx`, `src/features/device/{EditDeviceSheet,DeleteDeviceSheet}.tsx`, `src/features/me/sheets/*`, `src/features/automate/ItemMenuSheet.tsx`, `writes.ts` (room rename/delete batch, layout cleanup, delete rule/scene), `vi.sh1/sh3/sh4/sh5/sh6`.
Artboards: `design/SH1-ChonSite.dc.html`, `design/SH3-SuaNhanh.dc.html`, `design/SH4-XacNhanXoa.dc.html` (step), `design/SH5-SiteRoom.dc.html` (all modes), `design/SH6-XoaAutomation.dc.html` (step); spec FR-F07, F09, F10, F12, F13.

- [X] T123 [US07] [model:sonnet] SH-1 site picker + "Thêm site" → SH-5 newSite — `src/features/home/SiteSheet.tsx`
- [X] T124 [US07] [model:sonnet] SH-3 quick edit from S-20 header (aria-expanded) → `updateDevicePresentation` + `device.rename` if renamed — `src/features/device/EditDeviceSheet.tsx`
- [X] T125 [US14] [model:sonnet] SH-4 two steps: `referencedIds` over rules+scenes list, checkbox, then `device.remove {force: !online}` → ack → Home; error toast — `src/features/device/DeleteDeviceSheet.tsx`
- [X] T126 [US07] [model:sonnet] SH-5 edit/confirm/newSite/pick; delete room batch (devices `roomId=null`, delete room, drop layout filter); long-press chip (500 ms) opens edit — `src/features/me/sheets/RoomSheet.tsx`, `src/features/home/RoomChips.tsx`, `src/transport/writes.ts`
- [X] T127 [US08] [model:sonnet] SH-6 menu + confirm for scene/rule (scene: list rules using its `scene.run` with "Sẽ lỗi") → delete doc — `src/features/automate/ItemMenuSheet.tsx`, `src/transport/writes.ts`
- [X] T128 [P] [US07] [model:haiku] `vi.sh1/sh3/sh4/sh5/sh6` verbatim — `src/i18n/vi.ts`
- [X] T129 [US14] [model:sonnet] Tests: SH-4 lists referencing rules; room delete batch contents; SH-6 scene references — `src/features/sheets.test.tsx`

**Verify**: `pnpm --filter web test && pnpm --filter web typecheck`

### B22 — Arrange mode · [US06] · [model:opus] · G7
Owns: `src/features/home/arrange/*`, `writes.ts` (`saveLayout`), arranging props in `DeviceTile`.
Artboards: `design/S01-SapXep.dc.html`; spec FR-F01 (arrange), D-02.

- [X] T130 [US06] [model:opus] Layout model: derive ordered tiles per `(site, filter)` from `Layout` + new devices appended by `createdAt`; reflow when `cols` differs; resize 1×1↔2×1 — `src/features/home/arrange/layoutModel.ts`
- [X] T131 [US06] [model:opus] `@dnd-kit` sortable grid (pointer + keyboard sensors, 60 fps), resize handle — `src/features/home/arrange/ArrangeGrid.tsx`
- [X] T132 [US06] [model:sonnet] Arrange chrome: long-press tile enters, chips dimmed/locked, SiteSwitcher disabled, "Xong" replaces +, hint text; SH-2 "Sắp xếp tile" enabled — `src/features/home/arrange/ArrangeBar.tsx`, `src/features/home/HomeScreen.tsx`
- [X] T133 [US06] [model:opus] Save debounced 500 ms, `rev+1`, `updatedAt` — `src/transport/writes.ts`
- [X] T134 [US06] [model:opus] Tests: reorder/resize produce valid `Layout`; reflow 2→4 cols; debounce — `src/features/home/arrange/arrange.test.ts`

**Verify**: `pnpm --filter web test -- src/features/home && pnpm --filter web typecheck`

### B23 — S-20 full: history + chart · [US13] · [model:sonnet] · G7
Owns: `src/transport/HistorySource.ts`, `src/features/device/PropertyChart.tsx`.
Artboards: `design/S20-ChiTiet.dc.html`; spec FR-F06.

- [X] T135 [US13] [model:sonnet] `HistorySource`: LAN `GET /api/history/{dev}/{prop}?from&to&step`; cloud `history.get` cmd → `result.points`; Query hook `useHistory` — `src/transport/HistorySource.ts`, `src/transport/hooks.ts`
- [X] T136 [US13] [model:sonnet] `PropertyChart` 24 h (lazy Recharts, 6 hour ticks), opened by tapping a numeric sensor row — `src/features/device/PropertyChart.tsx`, `src/features/device/PropertyRow.tsx`
- [X] T137 [US13] [model:sonnet] Tests: cloud vs LAN source selection; empty data state — `src/transport/history.test.ts`

**Verify**: `pnpm --filter web test && pnpm --filter web typecheck && pnpm --filter web build`

### B24 — Desktop ≥ 900 · [US04/US06/US09] · [model:sonnet] · G9
Owns: `src/app/DesktopShell.tsx`, responsive parts of screens, `Sheet` dialog mode.
Artboards: `design/D-Home.dc.html`, `design/D-RuleEditor.dc.html`, `design/D-ChiTiet.dc.html` (dialog); spec FR-F11.

- [X] T138 [US04] [model:sonnet] Sidebar shell (logo, SiteSwitcher, nav with aria-current + red dot, hub card) replacing TabBar ≥ 900 — `src/app/DesktopShell.tsx`, `src/app/TabLayout.tsx`
- [X] T139 [US04] [model:sonnet] D-Home: title row + "Sắp xếp" + "+ Thêm", 4-col grid, dashed "Thêm thiết bị" cell — `src/features/home/HomeScreen.tsx`, `DeviceGrid.tsx`
- [X] T140 [US09] [model:sonnet] D-RuleEditor two columns (preview from `summarizeTrigger/Action`, status card, history card, delete → SH-6 confirm) — `src/features/automate/editor/RuleEditorDesktop.tsx`
- [X] T141 [US04] [model:sonnet] Other screens: 640 column + title row; all sheets → centered dialog 480 — `src/components/dn/Sheet.tsx`, `src/app/SheetHost.tsx`
- [X] T142 [P] [US04] [model:haiku] Desktop strings verbatim (spec §8 Desktop row) — `src/i18n/vi.ts`
- [X] T143 [US04] [model:sonnet] Tests: breakpoint switches shell; sheet renders as dialog — `src/app/desktop.test.tsx`

**Verify**: `pnpm --filter web test && pnpm --filter web typecheck && pnpm --filter web build`

---

## Phase 5: Polish & cross-cutting

### B25 — PWA polish, bundle, optional smoke · [model:sonnet] · G10
Owns: `vite.config.ts` (PWA plugin), `public/` icons/manifest, `src/app/pwa.ts`, optional `e2e/smoke.spec.ts`.
Artboards: `design/S01-Toast.dc.html` (kind `update`); spec §5, §7.

- [X] T144 [model:sonnet] `vite-plugin-pwa` `registerType:autoUpdate`, manifest (name, theme colors from tokens, 192/512 maskable), `index.html` network-first; "Có bản mới" toast + "Tải lại" — `vite.config.ts`, `src/app/pwa.ts`
- [X] T145 [P] [model:haiku] Icons 192/512 maskable from design assets (ask if none exist → OQ) — `public/*`
- [X] T146 [model:sonnet] Offline dimmed tiles when `config.fromCache` and MQTT offline — `src/features/home/HomeTile.tsx`
- [X] T147 [model:sonnet] Bundle budget < 250 KB gzip: lazy S-30, chart, zxing; firebase chunk after shell — `vite.config.ts`, `src/app/router.tsx`
- [X] T148 [model:sonnet] QR scan on S-10 (`@zxing/browser`, lazy, parse `devicenet://claim?code=`) (OQ-05) — `src/features/onboarding/hub/QrScan.tsx`
- [ ] T149 [model:haiku] Optional single Playwright smoke (login mock → claim mock → pairing mock → toggle), not in default `test` — `e2e/smoke.spec.ts`

**Verify**: `pnpm --filter web test && pnpm --filter web typecheck && pnpm --filter web build && pnpm --filter web build:lan`

### B26 — Field Hardening & Real Device UX (post-62d605a) · [model:sonnet] · G11
Owns: auth flow, install scripts, me/history, realtime events, onboarding nav, editor refinements.
- [X] T150 [US01] [model:sonnet] Firebase Auth custom auth domain (`VITE_FIREBASE_AUTH_DOMAIN`), popup-blocked redirect fallback, silent cancel handling, and Bearer token in bootstrap request — `src/env.ts`, `src/lib/firebase.ts`, `src/features/auth/{firebaseAuth.ts,LoginScreen.tsx,session.ts}`, `src/features/auth/session.test.ts`
- [X] T151 [US02] [model:sonnet] Hub install scripts public hosting & copy UI for Linux/Windows — `public/agent/install.{sh,ps1}`, `src/features/onboarding/hub/StepInstall.tsx`, `src/features/onboarding/hub/AddHub.test.tsx`, `src/i18n/vi.ts`
- [X] T152 [US15/US16] [model:sonnet] Live HubDetailScreen with unclaim confirmation, site-room hierarchy view, activity history grouping by date & error filter chips — `src/features/me/{MeScreen.tsx,HubDetailScreen.tsx,HistoryScreen.tsx,history.ts}`, `src/features/me/Me.test.tsx`
- [X] T153 [US04/US12] [model:sonnet] Realtime MQTT event ingestion pipeline & HTTP 304 ETag optimization for LAN polling — `src/transport/inbound.ts`, `src/transport/lan/LanConfigSource.ts`, `src/stores/config.ts`
- [X] T154 [US02] [model:sonnet] Disable Automate tab during onboarding & setup URL guidance — `src/components/dn/TabBar.tsx`, `src/app/DesktopShell.tsx`, `src/features/onboarding/hub/StepCode.tsx`, `src/app/desktop.test.tsx`
- [X] T155 [US09] [model:sonnet] Stale siteId auto-healing & empty device placeholders with captions in Rule Editor sheets — `src/features/automate/editor/{RuleEditorScreen.tsx,TriggerSheet.tsx,ConditionSheet.tsx,ActionSheet.tsx,fields.tsx}`, `src/transport/cloud/FirestoreConfigSource.ts`, `src/transport/lan/LanConfigSource.ts`
- [X] T156 [US09] [model:sonnet] Delete condition/action buttons, property-type operator filtering, and preserve Automate tab state — `src/features/automate/editor/{RuleEditorScreen.tsx,ConditionSheet.tsx,ActionSheet.tsx,fields.tsx,RuleEditorScreen.test.tsx}`, `src/app/router.tsx`, `src/features/automate/{AutomateScreen.tsx,Automate.test.tsx}`, `src/stores/ui.ts`

**Verify**: `pnpm --filter web test && pnpm --filter web typecheck && pnpm --filter web build && pnpm --filter web build:lan` ✅ (277 tests passed)

---

## Dependencies & execution order

- G0 B01 → G1 {B02, B03, B04, B05} → G2 {B06 (needs B04+B05), B07 (B04), B08, B09 (B02+B03)} → G3 B10 → G4 B11 → G5 {B12, B13, B14, B15} → G6 B16 (**M-Local done**) → G7 {B17, B18, B20, B22, B23} → G8 {B19 (B17+B18), B21 (B17+B20)} → G9 B24 → G10 B25 → G11 B26.
- Shared files touched by several batches use **append-only** rules: `src/i18n/vi.ts` (own namespace), `src/transport/writes.ts` and `FirestoreConfigSource.ts` (add functions/listeners, don't edit others'). Parallel batches touching them rebase before verify.
- User stories: US-01 (B11) → US-02 (B12) → US-03 (B13) → US-04/05/15 (B14) and US-13 (B15) are independent once B11 is done; US-12 LAN (B16) needs B14.

## Implementation strategy

1. **MVP = M-Local (B01–B16)**: login → claim hub → pair + name → Home toggle with honest pending/rollback → device detail, in cloud dev and LAN build. Validate with quickstart Q1–Q7.
2. Then post-M-Local in G7 parallel (Automate, RuleEditor core, Me, arrange, history), G8 (editor UI, sheets), desktop, PWA polish.
3. Post-integration hardening in G11 (B26): auth domain fallback, onboarding tab state, realtime events, rule editor condition/action deletion & operator filtering.
4. Opus only on B05, B06, B10, B18, B22 (plus T034 interface in B07); everything else sonnet/haiku as tagged.
