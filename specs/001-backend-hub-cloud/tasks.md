# Tasks: 001 – Backend (hub-agent + Cloud API + infra + installers)

**Input**: `plan.md` (phases P1–P14), `research.md` (R1–R14), `data-model.md`, `quickstart.md`, `open-questions.md` (OQ-1..12, all accepted 2026-10-18), contracts in `specs/000-shared-contracts/` (import from `@devicenet/shared` only — never redefine).
**Tests**: required by constitution VI and spec §8 → included.

## Format
`- [ ] T### [P] [USn] [model:x] [M-Local] Description — files`
- `[P]` parallel inside the batch (different files). `[USn]` = spec §2 user story (US2 claim, US3 pairing, US4 state, US5 set, US9 automation, US12 LAN, US13 history, US14 remove, US15 liveness, US16 event log); omitted for setup/foundational.
- `[model:opus|sonnet|haiku]` = model tag (plan §tasks.md conventions). `[M-Local]` = part of the first milestone.
- One **batch** = one agent, small context: read only the files/sections listed in the batch header. Each batch ends with a **Verify** command that must pass before the batch is committed.

## Shared-file rules (parallel safety in one worktree)
- **Root `package.json`, `pnpm-lock.yaml`, `pnpm-workspace.yaml`, `firebase.json`** are touched ONLY by B01 and B13. B01 installs every dependency listed in plan "Primary Dependencies" for all packages up front. A later batch that needs a new dependency must **not** run `pnpm add` in parallel with another batch: it stops, notes the need, and the coordinator adds it serially.
- `apps/api/src/server.ts` is written in B05 with every route module registered (stub routes reply 501); later api batches edit only their own `routes/*.ts`/`services/*.ts`.
- `apps/hub-agent/src/core/commands.ts` (B04) dispatches through `src/core/handlers/<type>.ts`; post-M-Local command types start as stubs returning ack `internal` + message `not_implemented`; later batches edit only their handler file. Same for LAN routes `src/lan/routes/{history,events}.ts` (B12 stubs, 501).
- `apps/hub-agent/src/main.ts` (boot wiring) is owned by B13; post-M-Local batches that need wiring add it in a single serialized task at the end of their batch.
- Tools location: the worktree has no `.tools/`; hub-agent resolves `DN_TOOLS_DIR` env → else `<repoRoot>/.tools`. In this worktree set `DN_TOOLS_DIR=C:\Users\ptm9hc\Documents\devicenet\.tools` (or run `node scripts/fetch-tools.mjs`).

## Batch map

| Batch | Phase | Model | Group (parallel) | M-Local | Depends on |
|---|---|---|---|---|---|
| B01 Scaffold | P1 | haiku | G0 (alone, root files) | ✔ | — |
| B02 Hub foundation | P2 | sonnet | G1 | ✔ | B01 |
| B05 api foundation + bootstrap | P3 | sonnet | G1 | ✔ | B01 |
| B03 Z2M driver + mock Z2M | P2 | sonnet | G2 | ✔ | B02 |
| B06 api claim flow | P3 | opus | G2 | ✔ | B05 |
| B07 api webhook + dev cloud broker | P3/P4 | sonnet | G2 | ✔ | B05 |
| B04 Hub core (registry, publisher, set, cmd, pairing) | P2 | opus | G3 | ✔ | B03 |
| B08 Hub claim client | P4 | opus | G3 | ✔ | B02, B06 |
| B09 Firestore sync | P4 | sonnet | G4 | ✔ | B04, B08 |
| B10 Bridge dual broker | P4 | opus | G4 | ✔ | B04, B07 |
| B11 Supervisor (Mosquitto + Z2M) | P5 | sonnet | G4 | ✔ | B03 |
| B12 LAN server | P5 | sonnet | G4 | ✔ | B04 |
| B13 Boot wiring + dev orchestration + smoke (gate) | P6 | sonnet | G5 (alone, root files) | ✔ | B08–B12 |
| B14 Engine: compile + triggers + conditions | P7 | opus | G6 | | B13 |
| B17 History + events log | P9 | sonnet | G6 | | B13 |
| B18 Device lifecycle | P10 | sonnet | G6 | | B13 |
| B19 api remainder | P11 | sonnet | G6 | | B13 |
| B20 Infra (write only) | P12 | haiku | G6 | | B01 |
| B15 Runner + scenes + config apply | P7 | opus | G7 | | B14 |
| B16 Scheduler + sun | P8 | opus | G7 | | B14 |
| B21 Installers | P13 | sonnet | G7 | | B13 |
| B22 NFR hardening | P14 | sonnet | G8 | | B15–B18 |

Groups run in order G0 → G8; batches inside a group may run concurrently (disjoint directories, no root-file edits). B14/B15/B16 all live in `src/automation/` but own different files (listed).

---

## M-Local

### B01 Scaffold — P1 · haiku · G0
Read: plan §Project Structure, research R4/R14, root `package.json`, `tsconfig.base.json`, `packages/shared/package.json`.
- [X] T001 [model:haiku] [M-Local] Create `apps/hub-agent/package.json` (`@devicenet/hub-agent`, type module, bin `devicenet-agent`, scripts `dev` (tsx watch src/main.ts), `start`, `test` (vitest run), `typecheck`), deps: `@devicenet/shared` workspace, fastify 5, @fastify/static, mqtt 5, aedes, ws, better-sqlite3, pino, pino-roll, firebase, libsodium-wrappers, serialport, croner, suncalc, ulid, yaml, qrcode, zod 3; dev: tsx, vitest, typescript, @types/* — `apps/hub-agent/package.json`, `tsconfig.json`, `vitest.config.ts`
- [X] T002 [P] [model:haiku] [M-Local] Create `apps/api/package.json` (`@devicenet/api`; scripts `dev`, `start`, `test` (unit, excludes `test/emu`,`test/rules`), `test:emu` = `firebase emulators:exec --only auth,firestore --project demo-devicenet "vitest run --config vitest.emu.config.ts"`, `typecheck`), deps: shared, fastify 5, @fastify/cors, @fastify/helmet, @fastify/rate-limit, firebase-admin, libsodium-wrappers, ulid, zod; dev: @firebase/rules-unit-testing, firebase (client, tests), tsx, vitest — `apps/api/{package.json,tsconfig.json,vitest.config.ts,vitest.emu.config.ts}`
- [X] T003 [P] [model:haiku] [M-Local] Create `tools/dev-cloud-broker/package.json` (`@devicenet/dev-cloud-broker`; deps aedes, ws, mqtt (tests); bin `dev-cloud-broker`) — `tools/dev-cloud-broker/{package.json,tsconfig.json,vitest.config.ts}`
- [X] T004 [model:haiku] [M-Local] Root: add devDependency `firebase-tools`; `firebase.json` (projectId via `.firebaserc` `demo-devicenet`; emulators auth 9099, firestore 8085, ui 4000 host 127.0.0.1; `firestore.rules: infra/firestore.rules`); `.firebaserc` — `package.json`, `firebase.json`, `.firebaserc`
- [X] T005 [P] [model:haiku] [M-Local] Copy `specs/000-shared-contracts/contracts/firestore.rules` **verbatim** to `infra/firestore.rules`; add `infra/README.md` 3 lines "copy of contract, do not edit here" — `infra/firestore.rules`
- [X] T006 [model:haiku] [M-Local] `pnpm install`; placeholder `src/index.ts` + one trivial passing test per new package so suites are non-empty
- **Verify**: `pnpm --filter @devicenet/shared build && pnpm -r typecheck && pnpm -r test` ✅ PASS

### B02 Hub foundation — P2 · sonnet · G1
Read: data-model.md §1–§3, research R3/R10, spec FR-H01 (config/log), FR-H03 (Driver interface).
- [X] T007 [model:sonnet] [M-Local] Config: internal Zod schema + loader for `config.yaml` (fields per data-model §1, defaults: `serialPort: auto`, `dataDir ./.data/hub`, `lan {enabled:true, bind:"0.0.0.0", port:8080, webDir:"apps/web/dist-lan"}`, `mqttLocal {port:1883, wsPort:9001}`, `apiBaseUrl http://127.0.0.1:3000`), env overrides `DN_EMULATOR`, `DN_MOCK_Z2M`, `DN_API_BASE_URL`, `DN_CLOUD_MQTT_TLS`, `DN_TOOLS_DIR`, `DN_DATA_DIR`; paths helper — `apps/hub-agent/src/config/{schema,load,paths}.ts`, `test/config.test.ts`
- [X] T008 [P] [model:sonnet] [M-Local] Logger: pino JSON to stdout + `dataDir/logs` (pino-roll daily, keep 7); redaction helper so `set`/`state` payloads only appear at debug — `src/log/index.ts`, `test/log.test.ts`
- [X] T009 [model:sonnet] [M-Local] SQLite: `db.ts` (better-sqlite3, WAL), numbered migrations creating `meta, devices, config_snapshot, history, events, rule_state` exactly as data-model §2; typed repos `devices.ts`, `snapshot.ts`, `events.ts`, `history.ts` (insert/query only; retention later) — `src/store/*.ts`, `test/store.test.ts`
- [X] T010 [P] [model:sonnet] [M-Local] IDs + clock: `newId(prefix)` with `ulid` producing `<prefix>_<ULID>` that passes shared `DeviceId/EventId/RunId` schemas; injectable `Clock`/`TimerHost` interfaces (real + fake) — `src/core/ids.ts`, `src/core/clock.ts`
- [X] T011 [P] [model:sonnet] [M-Local] `Driver` interface copied from spec FR-H03 (types from `@devicenet/shared`), `DiscoveredDevice` type — `src/drivers/Driver.ts`
- [X] T012 [P] [model:sonnet] [M-Local] `ConfigStore` interface (signIn state, `createDevice`, `updateDeviceHubFields`, `putEvent`, `updateRuleHubFields`, `updateSceneHubFields`, `onDevices`, `onSite`, `onRules`, `onScenes`) + in-memory fake for tests — `src/sync/ConfigStore.ts`, `test/helpers/fakeConfigStore.ts`
- [X] T013 [P] [model:sonnet] [M-Local] Test helper: start aedes on ephemeral tcp port (+ optional ws) and return `{url, close}`; mqtt.js client helper with `waitFor(topic, predicate, ms)` — `test/helpers/brokers.ts`
- **Verify**: `pnpm --filter @devicenet/hub-agent typecheck && pnpm --filter @devicenet/hub-agent test`

### B05 api foundation + bootstrap — P3 · sonnet · G1
Read: api.openapi.yaml, spec §4 FR-A01 + security bullet, research R4, data-model §5, OQ-10/OQ-12.
- [X] T014 [model:sonnet] [M-Local] Fastify server: helmet, CORS (`http://localhost:*` + Hosting origin env), error body `{error:{code,message}}`, pino; registers **all** route modules (tenants, claimCodes, claim, credential, hubToken, hubDelete, emqxAuth, emqxAcl, webhook, healthz) with 501 stubs; `GET /healthz` → `{ok:true}` — `apps/api/src/server.ts`, `src/routes/*.ts`, `src/main.ts`
- [X] T015 [P] [model:sonnet] [M-Local] Firebase Admin init (`projectId` from env, default `demo-devicenet`; emulator env vars honoured) — `src/firebase.ts`
- [X] T016 [P] [model:sonnet] [M-Local] Auth plugins: `firebaseAuth` (verifyIdToken, exposes `uid`, `tenant`), `hubAuth` (`Authorization: Hub <hubId>:<secret>` → sha256 compare with `tenants/{t}/hubs/{h}/private/secret`, requires lookup by hubId via collectionGroup or `hubIndex` — use collectionGroup `private` query), `emqxToken` (`X-EMQX-Token` = env `EMQX_SHARED_TOKEN`) — `src/auth/*.ts`
- [X] T017 [US2] [model:sonnet] [M-Local] `POST /v1/tenants/bootstrap` idempotent: tenant, owner member, site "Nhà" (timezone body || `Asia/Ho_Chi_Minh`, lat/lng optional), custom claims `{tenant, role:"user", acl:{pub:["t/<t>/h/+/d/+/set","t/<t>/h/+/cmd"], sub:["t/<t>/#"]}}` (002 depends on `role:"user"`) — `src/routes/tenants.ts`; `DELETE /v1/tenants/me` stays 501 until B19
- [X] T018 [P] [model:sonnet] [M-Local] Rate-limit config (`claim-codes` 10/h/IP, `claim` 20/h/uid; disabled when `DN_EMULATOR=1`) — `src/rateLimit.ts`
- [X] T019 [model:sonnet] [M-Local] Emulator test harness (create users with Auth emulator REST, get ID tokens, clear Firestore between tests) + bootstrap tests (created/idempotent/claims) + `firestore.rules` tests with `@firebase/rules-unit-testing` (tenant isolation, hub only hub column of devices/rules/scenes/hubs, user cannot set device `removed`, events create-only, claimCodes deny) — `test/emu/{harness,bootstrap.test}.ts`, `test/rules/firestore.rules.test.ts`
- **Verify**: `pnpm --filter @devicenet/api test && pnpm --filter @devicenet/api test:emu`

### B03 Z2M driver + mock Z2M — P2 · sonnet · G2
Read: 000 data-model §4 (exposes table + rules), spec FR-H03, research R1 (Z2M 2.x topics), `packages/shared/src/property.ts`.
- [X] T020 [model:sonnet] [M-Local] Fixture: real TS011F `bridge/devices` entry (definition + exposes: state, power, voltage, current, energy, power_on_behavior, indicator_mode, child_lock, linkquality) and a state sample — `apps/hub-agent/test/fixtures/ts011f.device.json`, `ts011f.state.json`
- [X] T021 [US3] [model:sonnet] [M-Local] `buildProperties(exposes)` per 000 §4 (keys kept snake_case, `accessFromZ2M`, category rules, precision, units, `valueLabels` for power_on_behavior, Vietnamese default labels) — `src/drivers/zigbee2mqtt/exposes.ts`; **constitution VI test** `test/drivers/exposes.test.ts` asserting the exact PropertyMap for the fixture
- [X] T022 [P] [US5] [model:sonnet] [M-Local] `toDriverValue`/`fromDriverValue` (binary ⇄ `"ON"/"OFF"`, numeric passthrough, enum strings) — `src/drivers/zigbee2mqtt/values.ts`, `test/drivers/values.test.ts`
- [X] T023 [US4] [model:sonnet] [M-Local] `Zigbee2mqttDriver` over an mqtt.js client to the local broker: parse `bridge/state` (JSON `{state}` or legacy string), `bridge/devices`, `bridge/event` `device_interview` status `successful`, `<fn>` state, `<fn>/availability`; `setProperty` → `<fn>/set`; `startPairing/stopPairing` → `bridge/request/permit_join {time}`; `rename` → `bridge/request/device/options {id, options:{description}}` (OQ-1); `assignFriendlyName(ieee, devId)` → `bridge/request/device/rename`; `removeDevice` → `bridge/request/device/remove {id, force}`; `ping` → `<fn>/get {state:""}`; request/response correlation via `bridge/response/...` with timeout — `src/drivers/zigbee2mqtt/driver.ts`
- [X] T024 [model:sonnet] [M-Local] Mock Z2M (MQTT-level, research R3): publishes bridge state/devices from fixture, echoes `/set` as state (configurable latency, `offline` flag, drop), handles permit_join/rename/options/remove requests with `bridge/response`, `emitInterview()` API; CLI entry for `pnpm dev` — `test/mock-z2m/{index,cli}.ts`
- [X] T025 [model:sonnet] [M-Local] Driver integration test with mock Z2M on aedes: discovery, state callback, set round-trip, availability, permit_join request — `test/drivers/driver.test.ts`
- **Verify**: `pnpm --filter @devicenet/hub-agent test -- test/drivers`

### B06 api claim flow — P3 · opus · G2
Read: spec FR-A02/A03/A07, 000 data-model §3.1, api.openapi.yaml hubs paths, research R5/R6, data-model §5, OQ-3.
- [X] T026 [US2] [model:opus] [M-Local] Sealed box service (libsodium-wrappers `crypto_box_seal`, base64) + hub secret gen (32 B base64url) + sha256 — `apps/api/src/services/{sealedBox,secrets}.ts`, `test/unit/crypto.test.ts` (round-trip with `crypto_box_seal_open`, exported test vector for hub B08)
- [X] T027 [P] [US2] [model:sonnet] [M-Local] Claim code generator (8 chars `ABCDEFGHJKLMNPQRSTUVWXYZ23456789`, `crypto.randomInt`, must match shared `ClaimCode.code` regex) — `src/services/claimCode.ts`, `test/unit/claimCode.test.ts`
- [X] T028 [US2] [model:sonnet] [M-Local] `POST /v1/hubs/claim-codes` → create `claimCodes/{code}` (create precondition, retry on collision), `expiresAt = now + 15 min`, `201 {code, expiresAt, pollEverySec:3}` — `src/routes/claimCodes.ts`
- [X] T029 [US2] [model:opus] [M-Local] `POST /v1/hubs/claim` transaction per research R6: 400 INVALID_CODE/EXPIRED/ALREADY_USED, 409 HUB_BELONGS_TO_OTHER_TENANT (OQ-3), site must exist in caller tenant; create `hubs/{hub_…}` (online:false, lastSeen:0, claimedAt/By, drivers), `private/secret {secretHash, alg:"sha256", rotatedAt}`; custom token `createCustomToken(hubId, {tenant, hubId, role:"hub"})` minted before tx; credential JSON `{tenantId, hubId, siteId, mqtt{host,port,wssPort,username:"hub:<hubId>",password}, firebaseCustomToken, apiBaseUrl}` from env `DN_MQTT_HOST/PORT/WSS_PORT` (dev 127.0.0.1/1884/8084, OQ-8) sealed with `hubPubKey` — `src/routes/claim.ts`
- [X] T030 [US2] [model:opus] [M-Local] `GET /v1/hubs/claim-codes/{code}/credential`: tx → 404 not claimed, 200 + delete blob + set `credentialTakenAt`, 410 expired/consumed — `src/routes/credential.ts`
- [X] T031 [P] [US2] [model:sonnet] [M-Local] `POST /v1/hubs/{hubId}/token` (hubAuth) → new custom token — `src/routes/hubToken.ts`
- [X] T032 [US2] [model:sonnet] [M-Local] Emulator tests (constitution VI): claim happy, expired, used, other tenant, invalid format, credential twice → 410, token refresh with good/bad secret; custom token signs in to Auth emulator with claims — `test/emu/claim.test.ts`
- **Verify**: `pnpm --filter @devicenet/api test && pnpm --filter @devicenet/api test:emu`

### B07 api webhook + dev cloud broker — P3/P4 · sonnet · G2
Read: spec FR-A05, api.openapi.yaml `/v1/emqx/webhook`, research R8, data-model §5, OQ-2, dev-env.md.
- [X] T033 [US15] [model:sonnet] [M-Local] `POST /v1/emqx/webhook` (emqxToken): `parseTopic`; `status` → `HubStatus.safeParse`; empty payload → 204 ignore; Firestore tx writes `hubs/{h}` `{online,lastSeen,agentVersion,z2mVersion,platform,lanUrl,ip,deviceCount}` only if `payload.ts ≥ stored lastSeen`; LWT (`ts=0`) → `online:false`, `lastSeen=publish_received_at`; `events` topic → 204 no-op (OQ-2) — `apps/api/src/routes/webhook.ts`
- [X] T034 [US15] [model:sonnet] [M-Local] Emulator tests: online, LWT, stale ts ignored, bad token 401, unknown hub 204 — `test/emu/webhook.test.ts`
- [X] T035 [model:sonnet] [M-Local] Dev cloud broker library `startDevCloudBroker({tcpPort=1884, wsPort=8084, webhookUrl, token})`: aedes + net + ws server accepting WebSocket upgrades on **any path** (incl. `/mqtt`, 002 uses `ws://localhost:8084/mqtt`); no auth (optional `DEV_BROKER_HUB_AUTH=1` → api `/v1/emqx/auth|acl` for `hub:` usernames) — `tools/dev-cloud-broker/src/index.ts`
- [X] T036 [model:sonnet] [M-Local] Mirror `t/+/h/+/status` publishes (incl. retained clears and LWT) → POST webhook `{topic, payload, publish_received_at}` with `X-EMQX-Token`, 3 retries on ECONNREFUSED; CLI reading env (`EMQX_SHARED_TOKEN` default `dev-token`) — `src/mirror.ts`, `src/cli.ts`
- [X] T037 [model:sonnet] [M-Local] Tests: stub HTTP server receives mirrored status with token; non-status topics not mirrored; ws client connects on `/mqtt` and on `/` — `tools/dev-cloud-broker/test/broker.test.ts`
- **Verify**: `pnpm --filter @devicenet/dev-cloud-broker test && pnpm --filter @devicenet/api test:emu`

### B04 Hub core — P2 · opus · G3
Read: spec FR-H04/H05/H06, §8 edge cases, realtime §2.2/§2.3/§2.5, `packages/shared/src/mqtt.ts`, data-model §3.
- [X] T038 [US4] [model:sonnet] [M-Local] Registry: `deviceId ↔ externalId ↔ friendlyName`, merge only keys in `properties`, `at[key]` on change, `lastSeen`, online; load/save via `store/devices.ts` — `apps/hub-agent/src/core/registry.ts`, `test/core/registry.test.ts`
- [X] T039 [US4] [model:opus] [M-Local] Publisher: single `seq` counter, envelope `{v,ts,seq}`, `topicPolicy` QoS/retain, fan-out to N registered links with identical bytes; state coalescer (200 ms window, ≤1 msg/s/device, forced republish 60 s after last publish via per-device timer), retained clear for removed devices, `republishAll()` — `src/core/publisher.ts`, `test/core/publisher.test.ts` (fake timers; payloads parse with shared schemas)
- [X] T040 [US5] [model:sonnet] [M-Local] Set queue: per-device chain concurrency 1; validate every key with `validateValue` + `isWritable`, any failure → `events set.rejected` and drop; offline device → `set.rejected reason=device_offline` ≤1 s; never publish synthetic state — `src/core/setQueue.ts`, `test/core/setQueue.test.ts` (incl. §8 "true then false within 100 ms ends false, seq increasing" via mock Z2M)
- [X] T041 [model:opus] [M-Local] Commands: `CommandEnvelope.safeParse` (fail → ack `invalid`), dedupe `cmd.id` 60 s across sources, 5 s guard → ack `timeout`, handler registry `src/core/handlers/<type>.ts`; `pairing.*` mutex; M-Local handlers `device.rename` (OQ-1), `state.republish`, `config.resync`; stubs for `device.remove`, `device.ping`, `scene.run`, `actions.test`, `history.get` — `src/core/commands.ts`, `src/core/handlers/*.ts`, `test/core/commands.test.ts`
- [X] T042 [US3] [model:sonnet] [M-Local] Pairing: start → permit_join, retained `PairingState`, busy ack with current `expiresAt`, timer to expiry → `{active:false}` + permit_join 0; interview → `buildProperties`, new `dev_…`, assign friendly_name, Device doc (`status:"new"`, name `description||model`, `primaryProperty` by priority `[power, temperature, humidity, illuminance, energy]`, `toggleProperty` first writable binary, `roomId:null`, `icon:"plug"`) via `ConfigStore.createDevice`, registry insert even if store fails, `events device.found`, `found += id`, initial state (`/get` if none); refuse when unclaimed/no cloud (D-12) — `src/core/handlers/pairing.ts`, `src/core/pairing.ts`, `test/core/pairing.test.ts`
- [X] T043 [model:sonnet] [M-Local] Events emitter: build `HubEvent` (id `evt_`, hubId), store in SQLite `events`, publish via publisher, hand to uploader hook — `src/core/events.ts`
- **Verify**: `pnpm --filter @devicenet/hub-agent test -- test/core` ✅ PASS

### B08 Hub claim client — P4 · opus · G3
Read: spec FR-H02, 000 data-model §3.1, research R5, data-model §1/§4, OQ-5.
- [X] T044 [US2] [model:opus] [M-Local] Keys: generate/load X25519 keypair (libsodium) at `dataDir/hub.key` (0600 best effort), `openSealed(ciphertextB64)`; test decrypts api test vector from B06 (copy vector into `test/fixtures/sealed-vector.json`, no cross-package import) — `apps/hub-agent/src/claim/keys.ts`, `test/claim/keys.test.ts`
- [X] T045 [US2] [model:sonnet] [M-Local] Credentials: local Zod mirror of the OpenAPI credential shape, read/write `credentials.json` 0600, `updateToken()` — `src/claim/credentials.ts`
- [X] T046 [US2] [model:opus] [M-Local] Claim client state machine: `POST claim-codes` (`agentVersion`, `platform`), log `CLAIM CODE: XXXXXXXX (hết hạn HH:mm)`, poll credential every `pollEverySec` (3 s; D-09 exception), new code on 410/expiry, decrypt + save, emit `claimed` event (no restart); exposes current code for `/setup` — `src/claim/claimClient.ts`, `test/claim/claimClient.test.ts` (stub HTTP server)
- [X] T047 [P] [model:sonnet] [M-Local] CLI `devicenet-agent reset`: delete credentials + hub.key, keep Z2M data + `devices` table — `src/cli.ts`
- [X] T048 [model:sonnet] [M-Local] Token refresh helper (OQ-5): `POST /v1/hubs/{id}/token` with `Hub <hubId>:<password>` → persist — `src/claim/tokenRefresh.ts`
- **Verify**: `pnpm --filter @devicenet/hub-agent test -- test/claim`

### B09 Firestore sync — P4 · sonnet · G4
Read: spec FR-H07, realtime §3, research R4, firestore.rules (hub column), OQ-4/OQ-5/OQ-9, `src/sync/ConfigStore.ts`.
- [X] T049 [model:sonnet] [M-Local] `FirestoreConfigStore`: `initializeApp` (projectId from env, `demo-devicenet`), `initializeAuth` inMemoryPersistence, `initializeFirestore` memoryLocalCache; `DN_EMULATOR=1` → `connectAuthEmulator(http://127.0.0.1:9099)`, `connectFirestoreEmulator(127.0.0.1, 8085)`; `signInWithCustomToken`, on token errors refresh via B08 helper then retry — `apps/hub-agent/src/sync/firestoreStore.ts`
- [X] T050 [US3] [model:sonnet] [M-Local] Device sync: create (status "new", Device parse), hub-field updates only (`properties, model, vendor, description, firmware, status, removedAt, updatedAt, externalId`), `devices.synced` flag; listener `devices where hubId==me` → registry presentation fields; `sites/{siteId}` listener → site cache — `src/sync/deviceSync.ts`
- [X] T051 [US16] [model:sonnet] [M-Local] Event uploader: `setDoc` (no merge) of `EventDoc` with converter writing `expireAt` as `Timestamp.fromMillis(ts+30d)` (OQ-4); `permission-denied` on retry = already exists (OQ-9); mark `events.uploaded` — `src/sync/eventUploader.ts`
- [X] T052 [model:sonnet] [M-Local] Reconciler on (re)connect: rewrite unsynced devices, upload pending events; config snapshot writer (`config_snapshot` rows + etag) after each listener change — `src/sync/reconciler.ts`, `src/sync/snapshot.ts`
- [X] T053 [model:sonnet] [M-Local] Emulator integration test (signed custom token minted with Admin SDK in test): create device, update hub fields, user-field change reaches registry, event upload + duplicate tolerated — `test/sync/firestore.emu.test.ts` + script `test:emu` in hub-agent package.json **(adds a script only; no new dependency)**
- **Verify**: `pnpm --filter @devicenet/hub-agent test -- test/sync && pnpm --filter @devicenet/hub-agent test:emu`

### B10 Bridge dual broker — P4 · opus · G4
Read: spec FR-H05 (subscribe both), FR-H10, realtime §2.1/§2.3/§2.7, research R7, OQ-8, `src/core/publisher.ts`, `src/core/commands.ts`.
- [X] T054 [US15] [model:opus] [M-Local] `MqttLink`: mqtt.js wrapper with manual backoff 1→60 s, `connected` state, `onConnect` hook, subscribe on every connect, publish with policy — `apps/hub-agent/src/bridge/mqttLink.ts`
- [X] T055 [US15] [model:opus] [M-Local] Bridge: local link (`mqtt://127.0.0.1:1883` user `hub`) always; cloud link after claim (`mqtts://` unless `DN_EMULATOR=1`/`DN_CLOUD_MQTT_TLS=0` → `mqtt://`; `clientId hub-{hubId}`, `clean:false`, keepalive 30, username `hub:{hubId}`, LWT `hubLwt()` retained on `status`); both links registered with publisher; downlink `hubSubscriptions` from both → setQueue / commands; never forwards `zigbee2mqtt/#` — `src/bridge/bridge.ts`
- [X] T056 [US15] [model:sonnet] [M-Local] Status + heartbeat: `HubStatus` (agentVersion, z2m, z2mVersion, lanUrl, ip, platform, deviceCount) on connect and every 30 s to both — `src/bridge/heartbeat.ts`
- [X] T057 [US15] [model:opus] [M-Local] Reconnect republish: cloud `connect` → status online + `publisher.republishAll()` (state + pairing), seq keeps increasing — in `bridge.ts`
- [X] T058 [model:opus] [M-Local] Integration tests with two aedes + mock Z2M: set from cloud reaches device and state lands on both brokers; same cmd id via both brokers → one execution, one ack; kill/restart cloud broker → LWT seen, then retained state republished with higher seq; no `zigbee2mqtt/` topic on cloud — `test/bridge/bridge.test.ts`
- **Verify**: `pnpm --filter @devicenet/hub-agent test -- test/bridge`

### B11 Supervisor — P5 · sonnet · G4
Read: spec FR-H01/FR-H11 (Mosquitto ACL), research R1/R2/R3, data-model §1 (mosquitto/z2m files), `scripts/find-zigbee-port.ps1`, `installers/versions.json`.
- [X] T059 [model:sonnet] [M-Local] Serial detection: `SerialPort.list()` match `10C4:EA60` / `1A86:55D4` (case-insensitive), explicit `COMx` or `/dev/serial/by-id/*` override; clear error "Không tìm thấy USB Zigbee" when none — `apps/hub-agent/src/supervisor/serial.ts`, `test/supervisor/serial.test.ts` (mock list)
- [X] T060 [model:sonnet] [M-Local] Mosquitto: generate `mosquitto.conf` (`per_listener_settings true`; listener 1883 127.0.0.1 password_file+acl; listener 9001 ws 0.0.0.0 `allow_anonymous true` + anon ACL: read `t/#`, write `t/+/h/+/d/+/set`, `t/+/h/+/cmd`, no `zigbee2mqtt/#`), `passwd` via `mosquitto_passwd -b` for users `hub`, `z2m` (random passwords in `secrets.json`), `acl` (`hub` readwrite `#`, `z2m` readwrite `zigbee2mqtt/#`); spawn `${DN_TOOLS_DIR}/mosquitto/mosquitto.exe` (Linux `mosquitto`) — `src/supervisor/mosquitto.ts`, `test/supervisor/mosquitto.test.ts` (golden conf)
- [X] T061 [model:sonnet] [M-Local] Z2M: write/merge `dataDir/z2m/configuration.yaml` per research R1 (ember, frontend disabled, availability, homeassistant off, mqtt user `z2m`), keep `devices:`/`groups:`; spawn `process.execPath ${DN_TOOLS_DIR}/zigbee2mqtt/index.js` with `ZIGBEE2MQTT_DATA`; readiness = `bridge/state online` ≤ **60 s**; on timeout log a clear error (Z2M+ember hangs ~40 s silently when the COM port is wrong) and set health `z2m:"offline"` with `lastError` — `src/supervisor/z2m.ts`, `test/supervisor/z2mConfig.test.ts`
- [X] T062 [model:sonnet] [M-Local] Child watchdog: spawn without shell, `windowsHide`, stdout→logger, backoff 2→30 s, >3 crashes/10 min → `hub.warning code=child_crashloop`, pid files `dataDir/run/*.pid`, kill stale pids at boot, stop = kill then `taskkill /T /F` after 5 s on Windows — `src/supervisor/child.ts`, `test/supervisor/child.test.ts` (spawns `node -e` dummies)
- [X] T063 [P] [model:sonnet] [M-Local] Embedded broker fallback (mock mode + no Mosquitto): aedes tcp 1883 + ws 9001 with the same ACL rules in `authorizePublish/Subscribe` — `src/supervisor/embeddedBroker.ts`, `test/supervisor/embeddedBroker.test.ts`
- **Verify**: `pnpm --filter @devicenet/hub-agent test -- test/supervisor`

### B12 LAN server — P5 · sonnet · G4
Read: hub-lan.openapi.yaml, spec FR-H11, research R10, OQ-7/OQ-11.
- [X] T064 [US12] [model:sonnet] [M-Local] Fastify server on `lan.bind:lan.port`; private-IP guard (RFC1918, loopback, link-local, IPv6 ULA/loopback; else 403) — `apps/hub-agent/src/lan/{server,privateIpGuard}.ts`, `test/lan/guard.test.ts`
- [X] T065 [US12] [model:sonnet] [M-Local] `GET /api/health` (ok, agentVersion, z2m, z2mVersion, mqttLocal, mqttCloud, firestore, claimed, ts; plus `lastError` when Z2M failed) — `src/lan/routes/health.ts`
- [X] T066 [US12] [model:sonnet] [M-Local] `GET /api/config` from `config_snapshot` with ETag / 304 — `src/lan/routes/config.ts`
- [X] T067 [US2] [model:sonnet] [M-Local] `/setup` server-rendered page: code, expiry, QR SVG of `devicenet://claim?code=` (`qrcode`), "đã claim" state; strings in `src/lan/strings.vi.ts` (OQ-11) — `src/lan/routes/setup.ts`
- [X] T068 [US12] [model:sonnet] [M-Local] Static serve `lan.webDir` (`apps/web/dist-lan`) with SPA fallback; missing dir → plain page "LAN web chưa build"; stubs `/api/history/...`, `/api/events` → 501 — `src/lan/routes/{static,history,events}.ts`
- [X] T069 [US12] [model:sonnet] [M-Local] Tests via `fastify.inject`: health, config etag, guard, setup contains code, static fallback — `test/lan/lan.test.ts`
- **Verify**: `pnpm --filter @devicenet/hub-agent test -- test/lan`

### B13 Boot wiring + dev orchestration + smoke — P6 · sonnet · G5 (gate)
Read: plan §Architecture (boot order), research R14, quickstart.md, dev-env.md.
- [X] T070 [model:sonnet] [M-Local] `main.ts` boot order per plan (config → log → SQLite → supervisor/embedded broker → local link → driver → registry → LAN → claim client | sync + cloud link), live transition on `claimed`, graceful shutdown (status offline, stop children, write `meta.lastHeartbeatAt`) — `apps/hub-agent/src/main.ts`
- [X] T071 [model:sonnet] [M-Local] Mock mode wiring: `DN_MOCK_Z2M=1` starts mock Z2M (B03) in-process against the local broker, skips Z2M spawn — `src/main.ts`, `src/supervisor/index.ts`
- [X] T072 [model:sonnet] [M-Local] `tools/dev/run.mjs`: ordered start with TCP readiness (emulators → api → dev-cloud-broker → hub-agent with `DN_EMULATOR=1`, `DN_MOCK_Z2M=1` unless `--real` → `pnpm --filter @devicenet/web dev` if `apps/web` exists), env defaults (`EMQX_SHARED_TOKEN=dev-token`, `DN_MQTT_HOST=127.0.0.1`, `DN_MQTT_PORT=1884`, `DN_MQTT_WSS_PORT=8084`, emulator hosts), prefixed output, Ctrl+C tree kill (`taskkill /T`) — `tools/dev/run.mjs`
- [X] T073 [model:haiku] [M-Local] `tools/check-tools.mjs` (mosquitto.exe, mosquitto_passwd.exe, zigbee2mqtt/index.js + dist present under `DN_TOOLS_DIR`, java on PATH) — `tools/check-tools.mjs`
- [X] T074 [model:sonnet] [M-Local] `tools/smoke/local.mjs` (< 30 s): api `/healthz`, hub `/api/health`, LAN ws `ws://127.0.0.1:9001` subscribe `t/+/#`, take first retained state, publish `set` toggling the first writable binary, wait new `state` ≤ 3 s, exit code — `tools/smoke/local.mjs`
- [X] T075 [model:haiku] [M-Local] Root scripts: `dev` (`node tools/dev/run.mjs`), `dev:real` (`… --real`), `smoke`, `tools:fetch` (`node scripts/fetch-tools.mjs`), `tools:check` — root `package.json`
- [X] T076 [model:sonnet] [M-Local] Walk quickstart M-Local steps 1, 2, 4 (claim via api using an emulator user created by script), 6, 7 in mock mode; fix defects in owning files; record results in `.orchestration/progress.md` log line only
- **Verify**: `pnpm -r typecheck && pnpm test && pnpm dev` (in another shell) `&& pnpm smoke`

---

## After M-Local

### B14 Engine: compile + property triggers + conditions — P7 · opus · G6
Read: spec FR-H08, realtime §5, `packages/shared/src/rule.ts`, `src/core/clock.ts`. Owns `src/automation/{compile,engine,conditions}.ts`.
- [X] T077 [US9] [model:opus] Compile Rule → closure set; index `Map<"dev.prop", CompiledRule[]>`; broken detection (device removed / property missing) → `lastResult="broken"`, `brokenReason`, `events rule.broken` — `apps/hub-agent/src/automation/compile.ts`
- [X] T078 [US9] [model:opus] Property trigger: rising edge, `prev` seeded from registry at load (no fire at boot), `for` cancellable timer, `changed` op — `src/automation/engine.ts`
- [X] T079 [US9] [model:opus] Conditions: `all`/`any` one nesting level, property, timeWindow (overnight), dayOfWeek, sun (current time vs today's sun times) in site tz — `src/automation/conditions.ts`
- [X] T080 [US9] [model:opus] **Constitution VI tests**: rising edge, `for=180` with 4 W↔6 W oscillation never fires then stable < 5 W 180 s fires exactly once (spec §8), boot seeding, `changed` — `test/automation/engine.test.ts`
- [X] T081 [US9] [model:sonnet] Conditions tests incl. overnight window 22:00–06:00 Asia/Ho_Chi_Minh — `test/automation/conditions.test.ts`
- **Verify**: `pnpm --filter @devicenet/hub-agent test -- test/automation`

### B17 History + events log — P9 · sonnet · G6
Read: spec FR-H09, hub-lan.openapi.yaml history/events, mqtt.ts `history.get`, realtime §2.5. Owns `src/store/history.ts`, `src/lan/routes/{history,events}.ts`, `src/core/handlers/history.get.ts`, `src/store/retention.ts`.
- [X] T082 [US13] [model:sonnet] History writer hook (numeric only, ≤1 row/10 s/property) + bucketed avg query (`step` s) — `src/store/history.ts`
- [X] T083 [US13] [model:sonnet] `GET /api/history/{deviceId}/{property}` (`from` default now−24h, `to`, `step` 300) → `{points}` — `src/lan/routes/history.ts`
- [X] T084 [US13] [model:sonnet] `history.get` handler: ≤300 points, ack `result {points}`, answer ≤2 s — `src/core/handlers/history.get.ts`
- [X] T085 [US16] [model:sonnet] `GET /api/events?limit&before` from SQLite in EventDoc shape — `src/lan/routes/events.ts`
- [X] T086 [model:sonnet] Retention: hourly croner job deleting history > 7 d, events > 30 d — `src/store/retention.ts`
- [X] T087 [model:sonnet] Tests: throttle, buckets, 300-point cap, routes, retention — `test/history/*.test.ts`; then serialized wiring task: register history hook + retention in `src/main.ts`
- **Verify**: `pnpm --filter @devicenet/hub-agent test -- test/history`

### B18 Device lifecycle — P10 · sonnet · G6
Read: 000 data-model §3.7, spec FR-H06 (recovery), D-10. Owns `src/core/handlers/device.{remove,ping}.ts`, `src/core/lifecycle.ts`.
- [X] T088 [US14] [model:sonnet] `device.remove`: Z2M remove (force), Firestore `status:"removed"`, `removedAt`, retained state clear, rules/scenes referencing it (`referencedIds`) → broken, `events device.removed` — `src/core/handlers/device.remove.ts`
- [X] T089 [US14] [model:sonnet] `device.ping` → driver ping + ack — `src/core/handlers/device.ping.ts`
- [X] T090 [US4] [model:sonnet] Availability → `state.online` + `device.online/offline` events (only on change) — `src/core/lifecycle.ts`
- [X] T091 [US3] [model:sonnet] Startup recovery: Z2M devices without registry entry → create `status:"new"` (FR-H06) — `src/core/lifecycle.ts`
- [X] T092 [model:sonnet] Tests with mock Z2M — `test/core/lifecycle.test.ts`
- **Verify**: `pnpm --filter @devicenet/hub-agent test -- test/core`

### B19 api remainder — P11 · sonnet · G6
Read: spec FR-A04/A06, api.openapi.yaml emqx + hub delete. Owns `apps/api/src/routes/{emqxAuth,emqxAcl,hubDelete,tenants}.ts`, `src/services/emqxAdmin.ts`.
- [X] T093 [US15] [model:sonnet] `/v1/emqx/auth`: username `^hub:(hub_[0-9A-Z]{26})$`, sha256(password) vs secret, 60 s cache, `{result}` — `src/routes/emqxAuth.ts`
- [X] T094 [US15] [model:sonnet] `/v1/emqx/acl`: publish `t/{tenant}/h/{hubId}/#`, subscribe `t/{tenant}/h/{hubId}/d/+/set|cmd`, else deny — `src/routes/emqxAcl.ts`
- [X] T095 [model:sonnet] `DELETE /v1/hubs/{hubId}`: tenant check, delete secret, EMQX REST kick `DELETE /api/v5/clients/hub-{hubId}` (skip when `EMQX_ADMIN_URL` unset), devices `removed`, rules/scenes `broken` — `src/routes/hubDelete.ts`, `src/services/emqxAdmin.ts`
- [X] T096 [P] [model:haiku] `DELETE /v1/tenants/me` → 202 placeholder (D-16) — `src/routes/tenants.ts`
- [X] T097 [model:sonnet] Tests: auth/acl unit, hub delete emulator — `test/unit/emqx.test.ts`, `test/emu/hubDelete.test.ts`
- **Verify**: `pnpm --filter @devicenet/api test && pnpm --filter @devicenet/api test:emu`

### B20 Infra (write only, never apply) — P12 · haiku · G6
Read: spec §5, research R12. Owns `infra/` except `firestore.rules`.
- [X] T098 [model:haiku] Terraform: provider, variables, VM e2-small Debian 12 + startup script, firewall 8883/8084/443/18083 (admin IP var) — `infra/terraform/{main,variables,vm,network}.tf`
- [X] T099 [P] [model:haiku] Terraform: Cloud Run (min 0/max 2), Firestore native + TTL on `events.expireAt`, Hosting, Secret Manager (`EMQX_SHARED_TOKEN`, `EMQX_ADMIN_KEY`) — `infra/terraform/{run,firestore,hosting,secrets}.tf`
- [X] T100 [P] [model:sonnet] EMQX `cluster.hocon` per spec §5 (JWT jwks + verify_claims, `acl_claim_name=acl`, `disconnect_after_expire=false`, HTTP authn/authz for `hub:`, `no_match=deny`, rule `status` → webhook, ssl 8883 / wss 8084, tcp/ws off) — `infra/emqx/cluster.hocon`
- [X] T101 [P] [model:haiku] VM compose (EMQX 5.8 + Caddy) + Caddyfile (sslip.io) — `infra/vm/{docker-compose.yml,Caddyfile}`
- [X] T102 [P] [model:haiku] `infra/firestore.indexes.json`: `devices(hubId,status)`, `rules(hubId,enabled)`, `events(ts desc)` + `firebase.json` reference **(serialize: firebase.json is a root file)**
- **Verify**: `terraform -chdir=infra/terraform fmt -check` (skip if terraform not installed); **never** `apply`

### B15 Runner + scenes + config apply — P7 · opus · G7
Read: spec FR-H08, 000 data-model §3.4/§3.5, mqtt.ts RunProgress. Owns `src/automation/{runner,configApply}.ts`, `src/core/handlers/{scene.run,actions.test}.ts`, `src/sync/ruleSync.ts`.
- [X] T103 [US9] [model:opus] Runner: `run_` id, sequential actions, `setProperty` via setQueue, cancellable `delay`, `runScene` one level, `notify` event, `RunProgress` per step change, final ok/partial/failed, cancel on `enabled=false`/rev change — `src/automation/runner.ts`
- [X] T104 [US9] [model:sonnet] `scene.run` (ack `{runId}` immediately) and `actions.test` (`source.kind="test"`, validate with `Action[]`) handlers — `src/core/handlers/{scene.run,actions.test}.ts`
- [X] T105 [US9] [model:sonnet] Rule/scene listeners (`where hubId==me`), diff by `rev`, compile, write `appliedRev` batch, `events config.applied`; `lastRunAt/lastResult` coalesced ≤1/10 s via `rule_state` — `src/sync/ruleSync.ts`, `src/automation/configApply.ts`
- [X] T106 [US9] [model:opus] Tests: run progress sequence, delay cancel, partial failure, runScene depth, appliedRev — `test/automation/runner.test.ts`
- [X] T107 [model:sonnet] Serialized wiring in `src/main.ts` (engine + ruleSync)
- **Verify**: `pnpm --filter @devicenet/hub-agent test -- test/automation`

### B16 Scheduler + sun — P8 · opus · G7
Read: spec FR-H08 scheduler bullet, §8 reboot case, OQ-6, rule.ts Schedule/Sun triggers. Owns `src/automation/{scheduler,sun}.ts`.
- [X] T108 [US10] [model:opus] Schedule triggers with croner `timezone=site.timezone`, `days` filter, reschedule on site/rule change — `src/automation/scheduler.ts`
- [X] T109 [US10] [model:opus] Sun triggers: suncalc from site lat/lng, offsetMin, daily recompute 00:05 site tz; missing coords → broken `site_missing_coordinates` — `src/automation/sun.ts`
- [X] T110 [US10] [model:opus] Missed-run on boot (OQ-6): last expected fire in `(meta.lastHeartbeatAt, now]` → no catch-up, one `hub.warning code=schedule_missed` — `src/automation/scheduler.ts`
- [X] T111 [US10] [model:opus] **Constitution VI tests**: Asia/Ho_Chi_Minh fire times (fake timers), days filter, sun times for fixed lat/lng/date ±1 min, missing coords, reboot 23:00:30 case — `test/automation/scheduler.test.ts`
- **Verify**: `pnpm --filter @devicenet/hub-agent test -- test/automation`

### B21 Installers — P13 · sonnet · G7
Read: spec FR-H12, research R11, `installers/versions.json`, `scripts/fetch-tools.mjs`. Owns `installers/` (not versions.json pins unless bumping).
- [X] T112 [model:sonnet] Windows SEA build: esbuild CJS bundle, `sea-config.json`, postject, copy native prebuilds (better-sqlite3, serialport) + `node.exe` for Z2M + Mosquitto + Z2M + web `dist-lan` into `out/windows/` — `installers/windows/{build-sea.mjs,sea-config.json}`
- [X] T113 [model:sonnet] `winsw.xml` + `install.ps1` (copy, service install, `powercfg -change standby-timeout-ac 0`, firewall Private 8080/9001, COM detection, `-WhatIf`) — `installers/windows/`
- [X] T114 [P] [model:sonnet] Linux: `docker-compose.yml` (pinned mosquitto/zigbee2mqtt images + hub-agent), `install.sh` (user, by-id, systemd), `devicenet.service` — `installers/linux/`
- [X] T115 [P] [model:haiku] Hub-agent Dockerfile (Node 22 slim) — `apps/hub-agent/Dockerfile`
- [X] T116 [model:sonnet] Dry-run checks — `installers/README.md` commands only
- **Verify**: `node installers/windows/build-sea.mjs --dry-run && pwsh -NoProfile -File installers/windows/install.ps1 -WhatIf`

### B22 NFR hardening — P14 · sonnet · G8
Read: spec §6.
- [X] T117 [model:sonnet] Latency histogram from `cmd.sentAt` → ack ts and set → state, logged every 10 min — `src/core/metrics.ts`
- [X] T118 [model:sonnet] Log redaction test (no set/state payload at info) — `test/log.test.ts`
- [X] T119 [model:sonnet] WAN-loss integration test: cloud broker down 1 simulated hour (fake timers) → property rules still run, events uploaded once after reconnect — `test/bridge/wanLoss.test.ts`
- [X] T120 [P] [model:haiku] RAM/CPU sampling script for 7-day run — `tools/soak/sample.mjs`
- [X] T121 [model:sonnet] api Dockerfile for Cloud Run — `apps/api/Dockerfile`
- **Verify**: `pnpm -r typecheck && pnpm test`

---

## Dependencies & strategy
- **MVP = M-Local (B01–B13)**: done when quickstart M-Local steps 1–7 pass with the dongle and `pnpm smoke` is green. Merge to main before starting G6.
- Critical path: B01 → B02 → B03 → B04 → B10 → B13 (bridge is the longest opus chain). api path B05 → B06 runs alongside.
- Parallel examples: G1 = B02 ∥ B05; G2 = B03 ∥ B06 ∥ B07; G4 = B09 ∥ B10 ∥ B11 ∥ B12; G6 = B14 ∥ B17 ∥ B18 ∥ B19 ∥ B20.
- Serialized touchpoints: root files (B01, B13, T102), `src/main.ts` wiring tasks (T087, T107), any new dependency.
- Commit per batch: `feat(001): B## <name>` + trailer; never edit `specs/000-*`, `spec.md`, `design/`, constitution.
