# Implementation Plan: 002 – Frontend PWA (`apps/web`)

**Branch**: `002-frontend-pwa` | **Date**: 2026-10-18 | **Spec**: [spec.md](./spec.md)
**Input**: `specs/002-frontend-pwa/spec.md`, constitution 1.2.0, `specs/000-shared-contracts/`, `docs/realtime-and-events.md`, `design/README.md` (canvas `1792254951-200a`), `.orchestration/dev-env.md`

Supporting artifacts: [research.md](./research.md) · [data-model.md](./data-model.md) (client-side state only) · [contracts/README.md](./contracts/README.md) (points to 000 + internal transport⇄feature contract) · [quickstart.md](./quickstart.md) · [open-questions.md](./open-questions.md)

## Summary

One React 19 + Vite 6 code base, two builds (`VITE_MODE=cloud|lan`) that differ **only** in `src/transport/` (spec §1, §3, §5). Realtime state comes from MQTT retained topics (subscribe `t/{tenant}/#` once), config from Firestore `onSnapshot` (cloud) or `GET /api/config` 30 s poll (LAN); commands go `cmd`→`ack` (5 s) and `set`→matching `state` (3 s rollback). UI is rebuilt from `design/` artboards on shadcn/ui primitives, styled with tokens generated from `design/ds/devicenet/tokens.json`.

Delivery is split into **M-Local** (runnable against Firebase emulators + local api + dev cloud broker + hub-agent LAN, see quickstart) and **Post-M-Local** (remaining screens, rule editor, arrange, desktop, PWA polish).

## Technical Context

**Language/Version**: TypeScript 5.x strict, ESM, Node.js 22 LTS (tooling)
**Primary Dependencies**: React 19, Vite 6, Tailwind 4 (`@tailwindcss/vite`), shadcn/ui (Radix primitives only), TanStack Router (code-based route tree), TanStack Query (REST only), Zustand 5 (vanilla stores), mqtt.js 5, Zod 3, Firebase JS SDK (auth + firestore, cloud build only), `@devicenet/shared` (workspace), `openapi-fetch` + `openapi-typescript` (types generated from `specs/000-shared-contracts/contracts/api.openapi.yaml`), lucide-react, `@fontsource/inter`, `ulid`. Post-M-Local: `@dnd-kit/*`, Recharts, `@zxing/browser`, `vite-plugin-pwa`.
**Storage**: Firestore (cloud, `persistentLocalCache` IndexedDB); `localStorage` for prefs mirror (theme/unit) only. No state in Firestore (constitution IV).
**Testing**: Vitest + Testing Library (jsdom) for components/screens; Vitest node env + `aedes` in-memory broker (TCP on ephemeral port) for transport integration; `vi.useFakeTimers` for pending/rollback/ack-timeout units. No long Playwright e2e (one optional smoke after M-Local).
**Target Platform**: Mobile browsers / iOS+Android PWA (390 wide first); desktop ≥ 900 px later (FR-F11). LAN build served by hub-agent at `http://<ip>:8080`.
**Project Type**: web SPA/PWA inside pnpm monorepo (`apps/web`).
**Performance Goals**: toggle→state ≤ 1 s LAN / ≤ 2 s cloud p95; Home 50 tiles < 1 s; first bundle < 250 KB gzip (spec §7; lazy Recharts, RuleEditor, zxing; firebase split chunk).
**Constraints**: optimistic ≤ 3 s; no polling except LAN `/api/config` 30 s and local countdown repaint; every MQTT message Zod-parsed (bad → `console.warn`, drop); `seq` dedupe; `clockOffset` compensation; UI strings only in `src/i18n/vi.ts`; types only from `@devicenet/shared`.
**Scale/Scope**: ~16 screens/sheets (35 artboards), ~14 DS components, 1 tenant, ≤ ~50 devices per site.

### Dev environment (MANDATORY, from `.orchestration/dev-env.md`)

| What | Cloud dev (`pnpm --filter web dev`, :5173) | LAN build (`build:lan`, served by hub-agent :8080) |
|---|---|---|
| Firebase | `demo-devicenet`; `VITE_USE_EMULATOR=1` → `connectAuthEmulator(http://127.0.0.1:9099)`, `connectFirestoreEmulator(127.0.0.1, 8085)` | not bundled |
| api | `VITE_API_URL=http://127.0.0.1:3000` | not used |
| MQTT | `VITE_MQTT_URL=ws://localhost:8084/mqtt` (full URL, mimics EMQX path; dev cloud broker accepts any path, aedes, **no auth**); app still sends `username=uid`, `password=idToken` (ignored in dev, required on EMQX) | `ws://${location.hostname}:9001` (Mosquitto, no auth) |
| Config | Firestore `onSnapshot` | `GET /api/config` every 30 s with `If-None-Match` |

Env files: `apps/web/.env.development` (cloud + emulator), `apps/web/.env.lan` (`VITE_MODE=lan`), `.env.example` documented. No NEEDS CLARIFICATION remain (resolved in research.md; residual coordination items in open-questions.md).

## Constitution Check

*GATE: before Phase 0 and re-checked after Phase 1.*

| Principle | How the plan complies | Status |
|---|---|---|
| I Hub-first | Web never calls api for control; all control via MQTT `set`/`cmd` to hub. LAN build works with no internet. | PASS |
| II Contract-first | All payload/doc types + `topics`, `parseTopic`, `topicPolicy`, timeouts, `summarize*`, `referencedIds`, `validateValue` imported from `@devicenet/shared`. REST types generated from `api.openapi.yaml`. Web defines only UI/store types and Firestore path helpers. | PASS |
| III Tenant isolation | Tenant from ID-token claim `tenant` (cloud) or `/api/config.tenantId` (LAN); every topic via `topics.*(tenant,…)`; every Firestore path under `tenants/{tenant}`. | PASS |
| IV MQTT realtime / listener / no polling | One `subscribe(t/{tenant}/#)` per connect; `onSnapshot` per collection; only LAN config poll (allowed exception) and countdown repaint (render-only, docs §4). Lint rule bans `setInterval` outside `transport/lan` and `CountdownRing`. | PASS |
| V Honest status | Display value = confirmed state; pending shows spinner; rollback at `SET_CONFIRM_TIMEOUT_MS`; banners for offline/LAN/reconnecting; "đã nạp" only when `appliedRev === rev`. | PASS |
| VI Tests | Transport tests (aedes) for optimistic/rollback/seq/ack/clock; RuleEditor validation tests (post-M-Local). | PASS |
| VII One operator | Root `pnpm dev`/`dev:real` + `tools/dev-cloud-broker` owned by 001; web owns only `apps/web` scripts (`dev`, `build`, `build:lan`, `test`, `typecheck`); no new services. | PASS |
| VIII Design-first | Every UI phase/task names its artboard (`design/<name>.dc.html`) + spec §; no pixel/strings copied here; canvas version check done centrally by the orchestrator before each UI batch at implement time; missing artboard → open-questions.md, stop. | PASS |
| Tech constraints | Stack exactly as constitution; shadcn only as primitives; `DeviceNet.*` names. | PASS |

Post-design re-check (after research/data-model/contracts): PASS, no violations → Complexity Tracking empty.

## Project Structure

### Documentation (this feature)

```text
specs/002-frontend-pwa/
├── spec.md             # input (never edited here)
├── plan.md             # this file
├── research.md         # Phase 0 decisions
├── data-model.md       # client stores / view models (wire + doc types live in 000)
├── contracts/README.md # pointer to 000 + transport⇄feature hook contract
├── quickstart.md       # M-Local run + validation guide
├── open-questions.md   # TODO-OQ items with tentative choices
└── tasks.md            # next step (/speckit-tasks), not created here
```

### Source Code

```text
apps/web/
├── index.html · vite.config.ts · tsconfig.json · vitest.config.ts · components.json (shadcn)
├── .env.development · .env.lan · .env.example
├── scripts/gen-tokens.ts         # design/ds/devicenet/tokens.json → src/styles/tokens.css (@theme, light/dark)
├── src/
│   ├── main.tsx · env.ts         # env parse (Zod) + VITE_MODE switch
│   ├── app/
│   │   ├── router.tsx            # code-based TanStack route tree (below)
│   │   ├── providers.tsx         # Theme, Session, Transport, QueryClient, Toast
│   │   ├── TabLayout.tsx         # header slot + bottom tab bar (+ sidebar ≥ 900 later)
│   │   ├── SheetHost.tsx         # renders ui.sheet (bottom sheet / dialog ≥ 900)
│   │   └── guards.ts             # beforeLoad auth / tenant / hub / mode redirects
│   ├── transport/                # ONLY place importing `mqtt` and `firebase/firestore`
│   │   ├── index.ts              # createTransport(mode) → Transport (dynamic import per mode)
│   │   ├── MqttClient.ts         # mqtt.js wrapper: connect, resubscribe, token refresh, status
│   │   ├── inbound.ts            # parseTopic → Zod parse → SeqGate → store dispatch
│   │   ├── SeqGate.ts · clockOffset.ts · PendingTracker.ts   # pure, unit-tested
│   │   ├── HubCommands.ts        # sendCommand (ack 5 s), setValues (pending 3 s)
│   │   ├── ConfigSource.ts       # interface; cloud/FirestoreConfigSource.ts, lan/LanConfigSource.ts
│   │   ├── HistorySource.ts      # post-M-Local
│   │   ├── writes.ts             # cloud Firestore writes (device presentation, rooms, hub name; later rules/scenes/layouts)
│   │   └── hooks.ts              # useDeviceState, useDevices, useHub, useSendCommand, useSetValues, …
│   ├── stores/                   # Zustand vanilla stores (see data-model.md)
│   │   └── deviceState.ts · connection.ts · config.ts · session.ts · ui.ts · toast.ts
│   ├── components/
│   │   ├── ui/                   # shadcn primitives (generated, behaviour/a11y only)
│   │   └── dn/                   # DeviceNet.*: Button, Chip, Switch, Slider, SegmentedTabs, Card, Sheet,
│   │                             #   Banner, Badge, Input, Stepper, DeviceTile + Toast, CodeInput, CountdownRing,
│   │                             #   StatusBanner, DeviceIcon, Header, TabBar, Row, Skeleton
│   ├── features/
│   │   ├── auth/       (S-00)
│   │   ├── onboarding/ (S-10 hub, S-11 device)
│   │   ├── home/       (S-01, SH-1, SH-2, arrange)
│   │   ├── device/     (S-20, SH-3, SH-4, PropertyChart)
│   │   ├── automate/   (S-02, S-30, SH-6, suggestions.ts)
│   │   └── me/         (S-03, hub detail, history, S-40, SH-5)
│   ├── lib/  firebase.ts · api.ts (openapi-fetch) · api.gen.ts · paths.ts · format.ts · deviceView.ts
│   ├── i18n/vi.ts
│   └── styles/ tokens.css (generated) · base.css (dn.css frame classes as Tailwind layers)
└── test/  setup.ts · aedes.ts (broker fixture) · fixtures/ (TS011F device + state)
```

**Routes** (code-based; tabs share `TabLayout`, full-screen flows do not):

| Path | Screen | Layout | Guard |
|---|---|---|---|
| `/login` | S-00 | bare | signed-out only (cloud) |
| `/home` | S-01 | Tab | session + tenant |
| `/automate`, `/automate/rule/$ruleId` (`new`), `/automate/scene/$sceneId` (`new`) | S-02, S-30 | Tab / bare | session (save needs cloud) |
| `/me`, `/me/hub/$hubId`, `/me/history`, `/settings` | S-03, hub detail, history, S-40 | Tab | session |
| `/device/$deviceId` | S-20 | bare (back) | session |
| `/onboarding/hub` | S-10 | bare | cloud only |
| `/onboarding/device?step=find\|name` | S-11 | bare | cloud only |

Sheets/dialogs (SH-1..SH-6, trigger/action sheets) are **not routes**: a discriminated `ui.sheet` state rendered by `<SheetHost/>` (bottom `Sheet` on mobile, centered dialog ≥ 900 px per FR-F11). LAN build: guards redirect S-10/S-11 to `/home`; no `/login` (boot from `/api/config`).

**Structure Decision**: single app `apps/web` in the pnpm monorepo depending on `@devicenet/shared` (`workspace:*`). Root workspace files (`package.json`, `pnpm-workspace.yaml`, `tsconfig.base.json`) exist on main; root `pnpm dev`/`dev:real` and `tools/dev-cloud-broker` are owned by 001; web tasks only touch `apps/web/**` (OQ-01 resolved). `@devicenet/shared` resolves to its `dist/` → run `pnpm --filter @devicenet/shared build` before web typecheck/test.

## Architecture decisions (details + alternatives in research.md)

1. **Transport factory**: `createTransport()` picks cloud/lan via `import.meta.env.VITE_MODE` with `await import()` so the LAN bundle contains no `firebase/*` (spec §5). `Transport = { mqtt, config, commands, history?, writes }`; `writes = null` in LAN → edit UI disabled (spec §5).
2. **Stores**: Zustand **vanilla** stores written only by transport; React reads through hooks with per-`deviceId` selectors (spec §3). TanStack Query only for REST (bootstrap, claim, delete hub) and history fetch; Firestore data never enters the Query cache.
3. **MQTT strategy**: one connection per session; `clean: true`, `keepalive: 30`, reconnect backoff 1 s → 10 s cap, `clientId = web-<uid|lan>-<ulid>`; on **every** `connect` → `subscribe(topics.tenantWildcard(t), {qos:1})`; `onIdTokenChanged` → update `client.options.password` without disconnect (docs §2.6). Status `connecting|online|reconnecting|offline` → `connection` store → `StatusBanner`.
4. **Inbound pipeline**: `parseTopic` → schema by kind (`HubStatus`, `DeviceState`, `PairingState`, `RunProgress`, `HubEvent`, `CommandAck`) → `SeqGate` (per-topic `lastSeq/lastTs`; accept `seq > last` or `ts > lastTs + 60 s`) → store. Empty retained payload on `state` = device removed → drop entry. App-originated kinds (`set`, `cmd`) ignored.
5. **clockOffset**: median of last 5 samples `status.ts − Date.now()` from **non-retained** `status` (retained can be ≤ 30 s stale; used only as provisional first sample). Exposed as `hubNow()`.
6. **Optimistic set**: `PendingTracker` per `(deviceId, key)` `{value, sentAt, timer}`; displayed = pending ?? confirmed; cleared when a newer `state` carries an equal normalized value; at `SET_CONFIRM_TIMEOUT_MS` → drop + timeout toast (FR-F01/F14); `events set.rejected` → drop + error toast. Confirmed state is never mutated optimistically, so rollback = removal.
7. **Commands**: `sendCommand(hubId, cmd)` builds `CommandEnvelope` (`cmd_<ULID>`, `sentAt`, `by`), publishes QoS1, resolves on matching `ack`, rejects `HubTimeoutError` at `CMD_ACK_TIMEOUT_MS`; never assumes success.
8. **ConfigSource**: cloud = one `onSnapshot` per collection (`sites`, `rooms` per site, `hubs`, `devices`; later `rules`, `scenes`, `layouts/{site}`, `events` limit 50), `persistentLocalCache` + multi-tab manager, docs Zod-parsed (bad → warn, skip). LAN = 30 s poll + ETag into the same `config` store shape. Paths centralised in `lib/paths.ts`.
9. **Components**: shadcn/Radix primitives (Switch, Slider, Dialog, ToggleGroup, RadioGroup, Checkbox) wrapped by `components/dn/*` whose look comes only from token classes; names match `DeviceNet.*`; props/variants referenced from `design/ds/devicenet/components/bundle.{js,css}` (never imported). `Sheet` = Radix Dialog anchored bottom (no extra lib).
10. **Tokens**: `scripts/gen-tokens.ts` generates committed `tokens.css` (`@theme` + `.dark`) from `tokens.json`; `gen:tokens --check` in test. Theme via `class="dark"` on `<html>` (light/dark/system).
11. **Auth (cloud)**: `signInWithPopup(GoogleAuthProvider)`, `signInWithRedirect` in iOS standalone; both work on the Auth emulator (fake account chooser). Missing `tenant` claim → `POST /v1/tenants/bootstrap {timezone}` → `getIdToken(true)`. Sign-out per FR-F00.
12. **i18n**: `vi.ts` nested `as const` object; interpolations as functions. Strings copied verbatim from artboards at implement time (spec §8 is the index).
13. **Formatting**: `format.ts` — `Intl.NumberFormat('vi-VN')` with property precision, relative time via `hubNow()`, `HH:mm` in site tz.

## Milestones & phases

Every UI phase lists its artboards; implementers read them at implement time **after the orchestrator's central canvas-version check** (constitution VIII). `tasks.md` will tag **every** task `[model:opus|sonnet|haiku]` and `[M-Local]` where applicable, grouped into **batches of 5–8 tasks**, each doable by one agent with small context and ending with a verification command (`pnpm --filter web test`, `pnpm --filter web typecheck`, `pnpm --filter web build` / `build:lan`). Model policy: **opus** only for transport (MqttClient/pipeline/optimistic/seq/clock), RuleEditor state + validation, drag-arrange layout; **sonnet** for screens/components; **haiku** for i18n strings, config, icons, env files.

### M-Local

| Phase | Content | Artboards / spec | Model mix |
|---|---|---|---|
| L0 Scaffold | `apps/web` Vite 6 + React 19 + TS strict + Tailwind 4 + Vitest + shadcn init; env files + `env.ts`; `build:lan` (`vite build --mode lan`, outDir `apps/web/dist-lan`, served by hub-agent, OQ-03 resolved); lint bans `mqtt`/`firebase/firestore` imports outside `transport/` | spec §1, §5; dev-env.md | haiku/sonnet |
| L1 Tokens & theme | `gen-tokens.ts` → `tokens.css`; Inter self-host; base frame classes from `design/dn.css`; theme (system default); `DeviceIcon` map (8 icons + router) | `ds/devicenet/tokens.json`, `dn.css`, `dn-icons.js`; spec §6, FR-F10 | haiku |
| L2 Foundation libs | `i18n/vi.ts` (M-Local screens), `format.ts`, `lib/firebase.ts` (emulator wiring), `lib/api.ts` + generated types, `lib/paths.ts`, `lib/deviceView.ts` (primary/toggle defaults, secondary sensors), store skeletons | spec §3, §8 | haiku/sonnet |
| L3 Transport core | `SeqGate`, `clockOffset`, `PendingTracker`, `MqttClient`, inbound pipeline, `HubCommands`, `createTransport`, hooks; aedes + fake-timer tests covering spec §9 (old seq / reboot, 3 rapid toggles, token refresh w/o disconnect, retained pairing countdown) | docs/realtime-and-events.md §2–4; spec §3, §9 | **opus** |
| L4 Config sources | Firestore `ConfigSource` (sites, rooms, hubs, devices) + `writes.ts` (device presentation, room create, hub rename); LAN `ConfigSource` (poll 30 s + ETag); tests with mocked fetch / Firestore adapter | spec §3, §5; firestore.ts/.rules | opus (interface) + sonnet |
| L5 DS components (M-Local set) | Button, Chip, Switch, Card, Sheet, Banner/StatusBanner, Badge, Input, Stepper, SegmentedTabs, DeviceTile (on/off/pending/offline/highlight), Toast host, CodeInput, CountdownRing, Skeleton, Header, TabBar; component tests (roles, states) | `ds/devicenet/components/bundle.*`; `S01-Home`, `S01-Toast`, `S10-NhapMa`, `S11-TimThietBi` | sonnet |
| L6 Shell + S-00 | router + guards, providers, TabLayout; Automate tab = static `S02-Trong` empty state, Me tab = minimal `S03-Me` (account card, Hub row with online state, Đăng xuất) (OQ-02 resolved), S-00 login + bootstrap + sign-out | `Main.dc.html`; FR-F00 | sonnet |
| L7 S-10 Add hub | 3 steps, copy block, CodeInput, claim errors 400/409, step-3 online detection (Firestore OR MQTT, > 60 s hint), hub name + site form; QR scan deferred (OQ-05) | `S10-CaiAgent`, `S10-NhapMa`, `S10-MaSai`, `S10-KetNoi`; FR-F04 | sonnet |
| L8 S-11 Pairing + naming | `pairing.start/stop`, countdown from retained `pairing` + `clockOffset`, FoundDeviceCard from `devices status=="new"`, timeout state, hub-offline block, naming (name, room chip + "Room mới" per OQ-04, icon, primary property) → write + `device.rename` → `/home` highlight | `S11-TimThietBi`, `S11-DatTen`, `S11-HetGio`; FR-F05 | sonnet |
| L9 S-01 Home | header (site name; + → SH-2 Home variant), StatusBanner (offline/LAN/reconnecting), RoomChips (filter only), DeviceGrid (layout order else `createdAt`), tile toggle pending/rollback toast, empty/roomEmpty/loading, tile → S-20 | `S01-Home`, `S01-Offline`, `S01-Trong`, `S01-Toast`, `SH2-MenuThem`; FR-F01, F09, F14 | sonnet |
| L10 S-20 basic | hero + big toggle (pending), Điều khiển (`PropertyControl` binary/numeric/enum), Cảm biến rows ("cập nhật x trước", stale), Cấu hình, Kỹ thuật, offline variant + `device.ping` (no chart, no SH-3/SH-4) | `S20-ChiTiet`, `S20-Offline`; FR-F06 | sonnet |
| L11 LAN build & wrap-up | LAN boot (no login; tenant/hub from `/api/config`; LAN banner), S-10/S-11 hidden, `build:lan` size check, quickstart checklist | spec §5; quickstart.md | sonnet/haiku |

Mapping to tasks.md: L0→B01, L1→B02, L2→B03+B04, L3→B05+B06+B10, L4→B07, L5→B08+B09, L6→B11, L7→B12, L8→B13, L9→B14, L10→B15, L11→B16; post-M-Local P1–P8 → B17–B25.

M-Local exit: quickstart scenarios Q1–Q7 pass manually; `pnpm --filter web test`, `typecheck`, `build`, `build:lan` green.

### Post-M-Local

| Phase | Content | Artboards / spec | Model |
|---|---|---|---|
| P1 S-02 Automate | SegmentedTabs, SceneCard + `scene.run` + `runs`, RuleCard (enabled `rev+1`, sync/broken badges), empty + SuggestionCard (`suggestions.ts`), SH-2 Automate variant, tab red dot | `S02-Scene`, `S02-Automation`, `S02-Trong`, `SH2-MenuThem`; FR-F02 | sonnet |
| P2 S-30 RuleEditor | editor state, Zod validation → vi messages, trigger sheet (device/time/sun, 7 ops, `for` min→s), action sheet, `@dnd-kit` reorder, save `rev+1` + appliedRev wait 5 s, `actions.test`, scene mode, validation tests | `S30-RuleEditor`, `S30-ChuaHopLe`, `S30-ChonTrigger`; FR-F08 | **opus** (state/validation) + sonnet (sheets) |
| P3 S-03 / S-40 | Me (account, HubRow, unnamed row, Site & Room, 5 events), hub detail + remove (`DELETE /v1/hubs/{id}`), history 7 days, S-40 (prefs → `members/{uid}.prefs`) | `S03-Me`, `S03-ChiTietHub`, `S03-LichSu`, `S40-CaiDat`; FR-F03 | sonnet |
| P4 Sheets | SH-1, SH-3, SH-4 (`device.remove`), SH-5 all modes (batch writes + layout cleanup), SH-6 | `SH1-*`, `SH3-*`, `SH4-*`, `SH5-*`, `SH6-*`; FR-F07, F09, F10, F12, F13 | sonnet |
| P5 Arrange mode | long-press → arranging, `@dnd-kit` sortable grid, 1×1↔2×1, layout debounce 500 ms `rev+1`, reflow by `cols` | `S01-SapXep`; FR-F01, D-02 | **opus** |
| P6 S-20 full | `HistorySource` (LAN `/api/history`, cloud `history.get`), lazy `PropertyChart` | `S20-ChiTiet`; FR-F06 | sonnet |
| P7 Desktop ≥ 900 | sidebar shell, D-Home 4 cols, D-RuleEditor 2 cols, sheet→dialog | `D-Home`, `D-RuleEditor`, `D-ChiTiet`; FR-F11 | sonnet |
| P8 PWA polish | `vite-plugin-pwa` autoUpdate + "update" toast, manifest/icons, offline dim tiles, bundle budget, Lighthouse, optional single Playwright smoke | `S01-Toast` (update); spec §5, §7 | sonnet/haiku |

## Testing strategy

- **Unit (node, fake timers)**: `SeqGate` (dup, out-of-order, reboot by `ts`), `clockOffset` (median, retained ignored), `PendingTracker` (per-key clear, 3 s rollback, 3 independent tiles), `HubCommands` ack match/timeout, `deviceView`, `format`.
- **Integration (node + aedes)**: subscribe once / resubscribe on reconnect, retained replay fills stores, malformed payload dropped with warn, token refresh keeps connection, toggle round-trip against a fake hub publishing `state`, `pairing.start` ack + retained pairing.
- **Component (jsdom)**: DS component states/roles; screens with a fake `Transport` (in-memory stores): S-01 toggle pending→rollback toast, S-10 code input + error, S-11 countdown from retained pairing, S-00 bootstrap redirect.
- **Post-M-Local**: RuleEditor validation suite (spec §9: `changed` hides value/`for`; 3 min → 180).
- Per-batch verification: `pnpm --filter web test && pnpm --filter web typecheck` (+ `build` / `build:lan` on shell and LAN batches).

## Risks

- `@devicenet/shared` merged (main 21c7340); consumed via built `dist/`.
- Firestore `isUser()` needs claim `role:"user"` — 001 FR-A01 bootstrap sets `{tenant, role:"user", acl}` (OQ-06 resolved); web relies on it.
- Bundle budget with Firebase (~100–130 KB gzip) → firebase in a separate chunk loaded after shell paint.

## Complexity Tracking

No violations.
