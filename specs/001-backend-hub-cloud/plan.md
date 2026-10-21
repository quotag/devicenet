# Implementation Plan: 001 – Backend (hub-agent + Cloud API + infra + installers)

**Branch**: `001-backend-hub-cloud` | **Date**: 2026-10-18 | **Spec**: [spec.md](./spec.md)
**Input**: `specs/001-backend-hub-cloud/spec.md` · contracts `specs/000-shared-contracts/` · `docs/realtime-and-events.md` · `.orchestration/dev-env.md` (mandatory port map)
**Artifacts**: [research.md](./research.md) · [data-model.md](./data-model.md) · [quickstart.md](./quickstart.md) · [contracts/](./contracts/README.md) (points to 000) · [open-questions.md](./open-questions.md)

## Summary

Build `apps/hub-agent` (Node 22 service supervising Mosquitto + Zigbee2MQTT, translating Z2M to the shared Property model, serving the LAN API/PWA, bridging selectively to the cloud broker, running automation), `apps/api` (Fastify on Cloud Run: bootstrap, claim, credential, hub token, EMQX auth/acl, status webhook), `tools/dev-cloud-broker` (aedes stand-in for EMQX in dev), `infra/` (Terraform + EMQX hocon, written never applied) and `installers/` (Windows SEA + winsw, Linux compose).
Delivery is ordered so **M-Local** lands first: tomorrow morning the owner runs `pnpm dev:real` on Windows with a real ZBDongle-E (`ember`) + TS011F plug, and the PWA (feature 002) can log in, claim the hub, pair the plug and toggle it — entirely on Firebase emulators (`demo-devicenet`) and the local dev broker. Key technical choices: research R1–R14.

## Technical Context

**Language/Version**: Node.js 22 LTS, TypeScript strict, ESM (SEA bundle is CJS via esbuild, installers only).
**Primary Dependencies**: `@devicenet/shared` (Zod 3 contracts — generated on main in parallel; import only, never redefine), Fastify 5 (+ `@fastify/static`, `@fastify/cors`, `@fastify/helmet`, `@fastify/rate-limit`), mqtt.js 5, aedes (dev broker + embedded test/mock broker), better-sqlite3, pino (+ `pino-roll`), `firebase` client SDK (hub), `firebase-admin` (api), `libsodium-wrappers` (sealed box), `serialport` (COM detection), `croner`, `suncalc`, `ulid`, `yaml`, `qrcode`, `tsx` (dev run).
**Storage**: Firestore (config; emulator 8085 in dev), SQLite `hub.db` at the hub (history, events, config snapshot, device cache). No other store (constitution VII).
**Testing**: Vitest (unit + integration with mock Z2M and in-memory aedes brokers, fake timers); Firebase emulator (`firebase emulators:exec`) for api claim flow + `firestore.rules` via `@firebase/rules-unit-testing`; one smoke script `pnpm smoke` < 30 s. No long-running e2e.
**Target Platform**: hub — Windows 10/11 x64 (primary for M-Local) and Linux (Debian/RPi via compose); api — Cloud Run (Node 22 container); VM — Debian 12 + EMQX 5.8 OSS + Caddy.
**Project Type**: pnpm monorepo services (`apps/hub-agent`, `apps/api`, `tools/dev-cloud-broker`, `tools/dev`, `infra`, `installers`).
**Performance Goals**: app→device p95 ≤ 1 s LAN / ≤ 2 s cloud; state→UI same; rule save→applied ≤ 2 s; `history.get` ack ≤ 2 s; claim → hub online ≤ 10 s (spec §6, D-09).
**Constraints**: hub-agent RAM < 150 MB, idle CPU < 2 %; 7-day uptime; WAN loss 1 h → 100 % rules run, no duplicate logs; payload < 4 KB (history ack ≤ 16 KB); no polling except D-09 credential poll, 30 s heartbeat, LAN `/api/config`; never log set/state payloads at info.
**Scale/Scope**: v1 = 1 tenant per user, 1 hub per site, ≤ 50 devices per hub, ≤ 100 rules; cloud cost < 15 USD/month.
**Dev map** (from dev-env.md, do not change): Auth emu 9099 · Firestore emu 8085 · Emulator UI 4000 · api 3000 · Mosquitto tcp 1883 (user) / ws 9001 (anon ACL) · dev cloud broker tcp 1884 / ws 8084 · hub LAN 8080 · web 5173 (002) · `EMQX_SHARED_TOKEN=dev-token`.
All former NEEDS CLARIFICATION items are resolved in research.md; residual spec↔contract gaps are OQ-1..OQ-12 — all tentative choices accepted by the orchestrator 2026-10-18. Tasks: [tasks.md](./tasks.md) (batches B01–B22).

## Constitution Check

*Gate before Phase 0 and re-checked after Phase 1 design — PASS (dev-only deviations justified in Complexity Tracking).*

| Principle | How this plan complies |
|---|---|
| I Hub-first | api has no device/rule logic; engine, set queue, pairing all in hub. LAN API + Mosquitto WS keep control working without WAN; events queue in SQLite and upload later. |
| II Contract-first | Every payload/doc/body imported from `@devicenet/shared`; 001 `contracts/` only points to 000. Hub-internal shapes (config.yaml, SQLite rows, credentials.json mirror of OpenAPI) are internal, never on a wire. Conflicts → open-questions.md, no contract edits. |
| III Tenant isolation ×3 | Firestore rules (verbatim `infra/firestore.rules`, emulator-tested), EMQX ACL (`acl` JWT claim + `/v1/emqx/acl` for hubs, hocon `no_match=deny`), api checks `token.tenant` on every handler. Hub uses client SDK + custom token only. Dev broker has no auth → dev-only, see Complexity. |
| IV MQTT realtime, Firestore config, no polling | Retained state/status/pairing; cmd id+ack+5 s; `onSnapshot` with `rev/appliedRev`; timers only for heartbeat, debounce, `for`/delay, schedule. Credential poll 3 s is mandated by D-09 (pre-auth) — noted in Complexity. |
| V Truthful state | Hub never publishes synthetic state after `set`; only Z2M reports. `appliedRev` written only after successful compile/load. |
| VI Tests | hub: TS011F exposes→Property fixture test, engine rising-edge + `for`, scheduler Asia/Ho_Chi_Minh + sun. api: claim happy/expired/used/other-tenant, rules via emulator. Each tasks.md batch ends with its test command. |
| VII One operator | `pnpm dev` = emulators + local broker (Mosquitto, or embedded aedes when absent in mock mode) + api + dev-cloud-broker + hub-agent (mock Z2M) + web. Terraform for cloud. Production uses only Firestore/EMQX/Cloud Run/Hosting/SQLite; aedes is dev/test tooling, never deployed. |
| VIII Design-first | Backend feature; only UI touchpoint is hub `/setup` (OQ-11) — minimal, no invented layout; LAN PWA is 002's build, served as static files. |
| Tech constraints | Node 22/TS strict/ESM, Fastify 5, mqtt.js 5, Zod 3, better-sqlite3, pino; epoch ms; `<prefix>_<ULID>`; boolean binary; seconds in rules; Z2M/Mosquitto pinned in `installers/versions.json`. |

## Project Structure

### Documentation (this feature)
```text
specs/001-backend-hub-cloud/
├── spec.md  plan.md  research.md  data-model.md  quickstart.md  open-questions.md
├── contracts/README.md      # pointer to specs/000-shared-contracts (no duplication)
└── tasks.md                 # produced later by /speckit-tasks
```

### Source code (repository root; 001 owns everything below except `apps/web`, `packages/shared`)
```text
package.json                 # 001 adds root scripts: dev, dev:real, smoke, tools:fetch, tools:check (002 owns apps/web scripts)
firebase.json                # emulators auth 9099 / firestore 8085 / ui 4000, rules → infra/firestore.rules
apps/hub-agent/
├── src/
│   ├── main.ts  cli.ts                  # entry; `devicenet-agent [run|reset]`
│   ├── config/   (schema.ts, load.ts, paths.ts)
│   ├── log/      (pino, rotation, payload redaction)
│   ├── store/    (db.ts, migrations.ts, devices.ts, history.ts, events.ts, snapshot.ts)
│   ├── supervisor/ (mosquitto.ts, z2m.ts, serial.ts, child.ts watchdog, embeddedBroker.ts)
│   ├── drivers/  (Driver.ts, zigbee2mqtt/{driver.ts, exposes.ts, values.ts})
│   ├── core/     (registry.ts, publisher.ts seq+coalescer, setQueue.ts, commands.ts dedupe+dispatch, pairing.ts, ids.ts)
│   ├── bridge/   (mqttLink.ts, bridge.ts local+cloud, heartbeat.ts)
│   ├── claim/    (keys.ts sealed box, claimClient.ts, credentials.ts)
│   ├── sync/     (ConfigStore.ts, firestoreStore.ts, deviceSync.ts, eventUploader.ts, reconciler.ts)
│   ├── automation/ (compile.ts, engine.ts, conditions.ts, runner.ts, scheduler.ts, sun.ts)   # post M-Local
│   └── lan/      (server.ts, privateIpGuard.ts, routes/{health,config,history,events,setup}.ts, strings.vi.ts)
└── test/ (fixtures/ts011f.*.json, mock-z2m/, helpers/brokers.ts, *.test.ts)
apps/api/
├── src/ (server.ts, firebase.ts, auth/{firebaseAuth,hubAuth,emqxToken}.ts,
│         routes/{tenants,claimCodes,claim,credential,hubToken,hubDelete,emqxAuth,emqxAcl,webhook,healthz}.ts,
│         services/{claimCode.ts, sealedBox.ts, secrets.ts, emqxAdmin.ts})
└── test/ (unit/*.test.ts, emu/*.test.ts, rules/firestore.rules.test.ts)
tools/dev-cloud-broker/ (src/index.ts lib + cli, test/)
tools/dev/run.mjs   tools/smoke/local.mjs   tools/check-tools.mjs   (scripts/fetch-tools.mjs, scripts/package-agent-win.mjs)
docs/ (runbook-local.md, runbook-gcp-deploy.md)
infra/ (firestore.rules [verbatim copy], firestore.indexes.json, terraform/*.tf, emqx/cluster.hocon, vm/{docker-compose.yml, Caddyfile})
installers/ (versions.json, windows/{build-sea.mjs, sea-config.json, winsw.xml, install.ps1}, linux/{docker-compose.yml, install.sh, devicenet.service})
```
**Structure decision**: services under `apps/`, dev-only tooling under `tools/` (workspace glob `tools/*` must be in `pnpm-workspace.yaml` — 001 adds it if main's monorepo step did not). `packages/shared` is consumed, never modified here.

## Architecture (hub-agent)

```
Z2M ⇄ zigbee2mqtt/# ⇄ [Mosquitto 1883] ⇄ driver(z2m) → registry → publisher(seq, coalesce) ─┬→ local link (1883) → Mosquitto ws 9001 → LAN PWA
                                                      ↑            ↓ engine (post M-Local)   └→ cloud link (EMQX | dev broker 1884)
           setQueue(per device) ← commands(dedupe 60 s, ack ≤5 s) ← set/cmd from BOTH links
sync/ConfigStore (Firestore client SDK) ⇄ devices/rules/scenes/site/events ; store/SQLite (cache, history, events outbox)
lan/ Fastify :8080 → /api/*, /setup, static apps/web lan build
```
- **Boot order**: config → logger → SQLite → supervisor (local broker, then Z2M; wait `bridge/state online` ≤ 60 s) → local link → driver → registry (from SQLite) → LAN server → claim state: unclaimed → claim client; claimed → sync (signIn) + cloud link + (later) engine. Claim completion triggers the claimed path live, no restart.
- **Single writer of `t/…` topics** is `publisher`; both links receive identical bytes; republish retained state/status/pairing on any link `connect`.
- **Firestore writes** go through `ConfigStore` (in-memory fake in unit tests) and touch only the hub column of `firestore.rules`.
- **OQ-driven behaviours**: rename → description (OQ-1); events `expireAt` Timestamp converter (OQ-4); token refresh on boot failure (OQ-5); cloud scheme by env (OQ-8); events create-only (OQ-9); target state awareness in engine; chained timeouts > 24 days; auto-unclaim on cloud deletion.

## Milestones & implementation phases

Phase 0 (research) and Phase 1 (design) are this document set. The implementation phases below are what `tasks.md` expands; **P1–P6 = M-Local** and merge before P7+.

### M-Local (target: owner runs `pnpm dev:real` tomorrow morning)
Acceptance = quickstart.md "M-Local validation" steps 1–7 + `pnpm smoke` green + all M-Local unit/emulator tests green.

| Phase | Scope (spec refs) | Exit check |
|---|---|---|
| **P1 Scaffold** | packages `@devicenet/hub-agent`, `@devicenet/api`, `@devicenet/dev-cloud-broker`; tsconfig (extends root), Vitest config, `firebase.json`, `infra/firestore.rules` verbatim copy, (`installers/versions.json` + `scripts/fetch-tools.mjs` already on main: Mosquitto 2.0.22, Z2M 2.14.2) | `pnpm -r typecheck && pnpm -r test` |
| **P2 Hub core on mock Z2M** | config/log/SQLite store; mock-z2m + TS011F fixture; Z2M driver (FR-H03, 000 data-model §4, rename via description OQ-1); registry + publisher (FR-H04, realtime §2.3/§2.5); set queue + validation + `set.rejected`/`device_offline` (FR-H05, §8); commands dispatcher + dedupe + 5 s ack guard (`pairing.*`, `device.rename`, `state.republish`, `config.resync`); pairing (FR-H06) with device creation via `ConfigStore` fake; local link + embedded aedes fallback | `pnpm --filter @devicenet/hub-agent test` |
| **P3 api M-Local** | Fastify skeleton + Admin SDK (emulator env) + auth plugins; `/healthz` (OQ-10); bootstrap FR-A01 (claims OQ-12); claim-codes; claim transaction + sealed box FR-A02 (OQ-3); credential GET FR-A03 (404/200/410); hub token FR-A07; webhook FR-A05 status + LWT + idempotency (OQ-2); rate limits; rules tests | `pnpm --filter @devicenet/api test && pnpm --filter @devicenet/api test:emu` |
| **P4 Dev broker + hub cloud** | `tools/dev-cloud-broker` (R8); claim client FR-H02 (keys, 15-min code loop, 3 s poll, decrypt, `credentials.json`, live transition, `reset` CLI, LAN reset `POST /setup/reset`, auto-unclaim on cloud deletion); Firestore sync FR-H07 (signIn + emulator, listeners `devices`/`sites/{siteId}`, device create/update, event uploader, reconciler, config snapshot); cloud link + LWT + heartbeat + reconnect republish FR-H10 | `pnpm --filter @devicenet/dev-cloud-broker test && pnpm --filter @devicenet/hub-agent test` |
| **P5 Supervisor + real Z2M + LAN** | COM detection R2; Mosquitto conf/passwd/acl + spawn (FR-H11 ACL); Z2M `configuration.yaml` + spawn + `bridge/state` wait; watchdog/backoff/crashloop warning FR-H01; LAN Fastify FR-H11: `/api/health`, `/api/config` (ETag), `/setup` (OQ-11), static `lan.webDir` (OQ-7), private-IP guard | `pnpm --filter @devicenet/hub-agent test && pnpm tools:check` |
| **P6 Dev orchestration + gate** | `tools/dev/run.mjs` (R14), root scripts `dev`, `dev:real`, `smoke`, `tools:*`; `tools/smoke/local.mjs`; walk quickstart M-Local steps in mock mode | `pnpm dev` (manual) + `pnpm smoke` < 30 s |

### After M-Local
| Phase | Scope | Exit check |
|---|---|---|
| **P7 Automation engine** | rules/scenes listeners + `rev/appliedRev` + `config.applied`; compile; property trigger rising edge + `for` + `changed`; conditions (all/any 1 level, timeWindow overnight, dayOfWeek, sun); runner (sequential, cancellable delay, `RunProgress`, `runScene` 1 level, `notify`); `scene.run`, `actions.test`; broken detection (FR-H08, realtime §5); lastRunAt coalescing; target state awareness (skip redundant commands); initial timer eval on load/rebuild | `pnpm --filter @devicenet/hub-agent test -- automation` |
| **P8 Scheduler + sun** | croner tz = site.timezone, reschedule on site change; suncalc daily 00:05; `site_missing_coordinates`; missed-run warning (OQ-6); chained timeouts > 24 days (`MAX_TIMEOUT_MS = 24 * 86_400_000`) | `… test -- scheduler` |
| **P9 History + events log** | `history` writes ≤1/10 s, retention 7 d / 30 d, hourly cleanup; `GET /api/history/{deviceId}/{property}`; `history.get` ≤300 pts ≤2 s; `GET /api/events` (FR-H09) | `… test -- history` |
| **P10 Device lifecycle** | `device.remove` (force, Firestore `removed`, retained clear, rules/scenes broken, `device.removed`), `device.ping`; availability → `device.online/offline`; startup recovery of Z2M devices missing in Firestore (FR-H06); pre-interviewed discovery on `pairing.start`; re-pairing SQLite conflict resolution (`DELETE FROM devices WHERE external_id = ? AND id != ? AND json_extract(doc, '$.status') = 'removed'`) | hub-agent tests |
| **P11 api remainder** | EMQX auth/acl FR-A04 (regex, sha256, 60 s cache); `DELETE /v1/hubs/{id}` FR-A06 (EMQX REST kick, devices removed, rules broken); `DELETE /v1/tenants/me` → 202 placeholder; helmet/CORS final | api unit + emu tests |
| **P12 Infra (write only) & GCP deploy** | Terraform (VM, firewall, Cloud Run, Firestore + TTL, Hosting, Secret Manager), `emqx/cluster.hocon` (spec §5), VM compose + Caddyfile, `firestore.indexes.json`; GCP Production Deployment Runbook (`docs/runbook-gcp-deploy.md`) | `terraform fmt -check`/`validate` if installed; **never apply** |
| **P13 Installers & Packaging** | `versions.json` final; Windows SEA + native prebuilds + bundled `node.exe` for Z2M + winsw + `install.ps1` (`scripts/package-agent-win.mjs`, `installers/windows/build-sea.mjs`); Linux compose + `install.sh` + systemd (FR-H12, R11) | build script dry-run; `install.ps1 -WhatIf` |
| **P14 NFR hardening** | pino rotation 7 d + payload redaction test; latency histogram (`sentAt`→ack); RAM/CPU check script; WAN-loss integration test with mock Z2M (rules keep running, events not duplicated) | hub-agent tests |

## Test plan (constitution VI mapping)
- **hub-agent** — required: (1) `drivers/zigbee2mqtt/exposes.test.ts`: TS011F fixture → exact PropertyMap (keys, category, access, precision, valueLabels); ON/OFF ⇄ boolean. (2) `automation/engine.test.ts`: rising edge, `for=180` with 4 W↔6 W oscillation (spec §8), `prev` seeding at boot, disable mid-run → cancelled. (3) `automation/scheduler.test.ts`: Asia/Ho_Chi_Minh fire times, sun times for fixed lat/lng/date, missing coords → broken. M-Local integration (mock-z2m + two aedes brokers): set → Z2M → state on both brokers; two sets in 100 ms end `false` with increasing `seq`; offline device → `set.rejected` ≤ 1 s; cmd dedupe across brokers; cloud reconnect republishes retained; claim crypto round-trip against api's sealed-box helper.
- **api** — claim happy / expired / used / other tenant (emulator), credential twice → 410, bootstrap idempotent + claims, webhook online / LWT / stale seq, `firestore.rules` (tenant isolation; hub only its column; user cannot set `removed`).
- **dev-cloud-broker** — status publish → webhook POST with token; other topics not mirrored.
- **Smoke** — `pnpm smoke` (< 30 s) against a running stack; the only end-to-end check. No long-running e2e.

## tasks.md conventions (for `/speckit-tasks`)
- Every task carries a model tag **`[model:opus|sonnet|haiku]`**:
  - **opus** only for genuinely hard work: automation engine edge/`for`/runner + scheduler/sun/missed-run; bridge dual-broker + seq/dedupe/coalescer/reconnect republish; claim crypto (sealed box both sides) + api claim/credential transactions.
  - **sonnet** default (driver, registry, LAN API, sync, supervisor, api routes, tests).
  - **haiku** mechanical (scaffolding, configs, verbatim rules copy, versions.json, Terraform boilerplate).
- Tasks in P1–P6 also carry **`[M-Local]`**.
- Tasks are grouped into **batches of 5–8 tasks** that one agent completes with a small context (one module area, explicit file list, spec/contract section refs instead of copied text). **Each batch ends with a runnable verification command** (`pnpm --filter … test`, `pnpm -r typecheck`, `pnpm smoke`).
- Batch order follows the phases; within M-Local, P2 and P3 run in parallel (different packages), P4 needs P2+P3, P5 needs P2, P6 needs P4+P5.

## Complexity Tracking

| Deviation | Why needed | Simpler alternative rejected because |
|---|---|---|
| Dev cloud broker (aedes) without auth/ACL (III) | M-Local must run on emulators without an EMQX VM | EMQX in Docker on Windows is heavy and its JWKS auth cannot validate Auth-emulator tokens. Production auth/ACL is covered by FR-A04 + hocon + tests; `DEV_BROKER_HUB_AUTH=1` exercises hub auth locally. |
| Embedded aedes local broker when Mosquitto is absent in mock mode (VII names Mosquitto) | `pnpm dev`/CI must work with zero downloaded binaries | Requiring Mosquitto for every test run blocks CI; `pnpm dev:real` always uses the pinned Mosquitto. |
| Credential poll every 3 s (IV) | Mandated by D-09; the hub has no identity before claim, so no listener is possible | Long-poll/SSE adds server state to scale-to-zero Cloud Run. |
