# Research — 001 Backend (hub-agent + cloud api + infra + installers)

Date: 2026-10-18 · Feeds `plan.md`. Every decision follows the constitution ("Ràng buộc kỹ thuật") and `.orchestration/dev-env.md`. Where a decision papers over a spec↔contract gap it is tagged `TODO-OQ-n` (see `open-questions.md`).

## R1. Z2M + Mosquitto as child processes on Windows (FR-H01)
- **Decision**: `core/supervisor` spawns both with `child_process.spawn` (no shell, `windowsHide: true`).
  - Mosquitto: `.tools/mosquitto/mosquitto.exe -c <dataDir>/mosquitto/mosquitto.conf` (Linux: `mosquitto` from PATH/compose). Supervisor generates the conf, `passwd` (via `.tools/mosquitto/mosquitto_passwd.exe -b`) and `acl` on every start. Readiness = TCP connect to 127.0.0.1:1883 succeeds.
  - Z2M: `process.execPath .tools/zigbee2mqtt/index.js` with `ZIGBEE2MQTT_DATA=<dataDir>/z2m`. Supervisor writes `configuration.yaml` (merge-preserving `devices:`/`groups:` that Z2M owns): `mqtt.server mqtt://127.0.0.1:1883` user `z2m`, `serial {port: COMx, adapter: ember}`, `frontend: {enabled: false}` (default 8080 collides with LAN API), `homeassistant: {enabled: false}`, `availability {enabled: true, active {timeout: 10}, passive {timeout: 1500}}`, `advanced.log_output: [console]`, `permit_join` absent (2.x). Readiness = `zigbee2mqtt/bridge/state` payload `{"state":"online"}` (also accept legacy string `online`) within 60 s; Z2M 2.14.2 + ember hangs ~40 s silently on a wrong/missing COM port, so the timeout must surface a clear log line and `/api/health` `lastError`.
  - Stop: `child.kill()`; on Windows fall back to `taskkill /PID <pid> /T /F` after 5 s. PIDs written to `<dataDir>/run/*.pid`; at boot stale PIDs are killed (Windows has no parent-death signal for children).
  - Watchdog: exponential backoff 2→30 s; >3 crashes in 10 min → `hub.warning code=child_crashloop` and keep retrying.
- **Rationale**: same Node 22 binary runs Z2M in dev; no Docker on Windows; config regeneration makes ports/users deterministic.
- **Alternatives**: Docker Desktop (too heavy for "PC cũ"); running Z2M in-process via `require` (couples crash domains, blocks watchdog).
- **Installer note (R11)**: a SEA exe cannot act as `node` for Z2M → Windows installer ships an official `node.exe` next to Z2M.

## R2. Serial port detection (FR-H01, §8 COM change)
- **Decision**: `serialport`'s `SerialPort.list()`; match `vendorId:productId` ∈ {`10C4:EA60`, `1A86:55D4`} (both accepted; see `scripts/find-zigbee-port.ps1`). `config.yaml serialPort` may be `auto` (default), an explicit `COMx`, or `/dev/serial/by-id/*`. Resolved at every Z2M (re)start so a COM renumber after reboot is picked up.
- **Alternatives**: WMI query via PowerShell (slower, extra process).

## R3. Dongle-free development: mock Z2M at the MQTT level
- **Decision**: `apps/hub-agent/test/mock-z2m` is an MQTT client that impersonates Z2M on the local broker: publishes `bridge/state`, `bridge/devices` (fixture TS011F with real `exposes`), responds to `<fn>/set` by echoing `<fn>` state (configurable latency/drop), handles `bridge/request/permit_join|device/rename|device/options|device/remove`, and can emit `bridge/event device_interview successful`. The real `Zigbee2mqttDriver` is used unchanged in mock mode (`DN_MOCK_Z2M=1`).
- When `DN_MOCK_Z2M=1` and `.tools/mosquitto` is absent, the hub uses an embedded **aedes** local broker (tcp 1883 + ws 9001, same ACL logic in code) so `pnpm dev` runs with zero binaries. `pnpm dev:real` always uses real Mosquitto.
- **Rationale**: tests exercise the real driver/topic mapping; one fixture shared by unit tests and `pnpm dev`.

## R4. Firebase client SDK in Node + emulator wiring (FR-H07, D-06)
- **Decision**: `firebase` (modular JS SDK) in hub-agent; `initializeAuth(app, { persistence: inMemoryPersistence })`, `initializeFirestore(app, { localCache: memoryLocalCache() })` (IndexedDB persistence does not exist in Node). When `DN_EMULATOR=1`: `connectAuthEmulator(auth, "http://127.0.0.1:9099")`, `connectFirestoreEmulator(db, "127.0.0.1", 8085)`, projectId `demo-devicenet`.
- api: `firebase-admin` with `FIRESTORE_EMULATOR_HOST=127.0.0.1:8085`, `FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099`, `GCLOUD_PROJECT=demo-devicenet`. `createCustomToken(hubId, {tenant, hubId, role:"hub"})` works unsigned on the emulator; `setCustomUserClaims` works on the emulator.
- Durability without IndexedDB: SQLite tables `config_snapshot` (for `/api/config` + cold start), `devices.synced` flag and `events.uploaded` flag; a reconciler re-writes unsynced docs after (re)connect (covers §8 "Firestore offline during pairing").
- Token: Node auth state is in-memory, so after a restart the stored custom token (1 h) is usually expired → on `signInWithCustomToken` failure (`auth/invalid-custom-token` / `auth/invalid-user-token` / expired) call `POST /v1/hubs/{id}/token` with the hub secret and retry. `TODO-OQ-5`.
- `firebase.json` (root, owned by 001): emulators auth 9099, firestore 8085, ui 4000, `firestore.rules = infra/firestore.rules` (verbatim copy of the contract).
- Prerequisite: firebase-tools CLI + **JDK 21** (Firestore emulator).

## R5. Claim crypto (FR-H02, FR-A02)
- **Decision**: `libsodium-wrappers` (WASM inlined, no native build) in both api and hub. Hub: `crypto_box_keypair()` → `hub.key` `{pk, sk}` base64, mode 0600 (best-effort on Windows; installer restricts the service dir ACL). api: `crypto_box_seal(JSON(credential), pk)` → base64 → `claimCodes/{code}.credential`. Hub: `crypto_box_seal_open`.
- Claim code: 8 chars from `ABCDEFGHJKLMNPQRSTUVWXYZ23456789` via `crypto.randomInt`, retry on collision (doc create precondition). Hub secret: 32 random bytes base64url; Firestore stores `sha256` hex in `hubs/{h}/private/secret`.
- **Alternatives**: tweetnacl + sealedbox shim (two libs, less audited); RSA-OAEP (contract permits, larger keys).

## R6. api claim transaction (FR-A02)
- **Decision**: one Admin SDK `runTransaction`: read `claimCodes/{code}` → validate format (400 INVALID_CODE before the read), missing → 400 INVALID_CODE, `expiresAt < now` → 400 EXPIRED, `used` → 400 ALREADY_USED or 409 HUB_BELONGS_TO_OTHER_TENANT (`TODO-OQ-3`), `siteId` must exist under caller tenant; then create `hubs/{hubId}` (online:false, lastSeen:0, claimedAt/By), `private/secret`, set `used/tenantId/hubId/credential`. Custom token minted **before** the transaction (no I/O inside retries except Firestore). Credential GET is a second transaction: return + `FieldValue.delete()` the blob, 410 when expired or already consumed (tracked by `credentialTakenAt`).

## R7. MQTT clients, seq, dedupe, debounce (FR-H04/H05/H10)
- **Decision**: mqtt.js 5. `bridge/` owns two `MqttLink`s (local always; cloud after claim) behind one `Publisher` that stamps `{v, ts, seq}` once and publishes the **same bytes** to both (`topicPolicy` QoS/retain). `seq` = in-memory per-hub counter, reset at boot (contract §2.3).
- Cloud link: `clientId hub-{hubId}`, `clean:false`, keepalive 30, `will = hubLwt()` retained on `status`, reconnectPeriod with manual backoff 1→60 s; on every `connect` → publish status online, republish all retained `state` + `pairing`.
- Downlink: subscribe `topics.hubSubscriptions()` on both links; `cmd` dedupe = LRU of `cmd.id` 60 s across both links; `set` → `p-queue`-style per-device chain (concurrency 1) shared by LAN, cloud and engine.
- State publish: per-device coalescer — 200 ms window, ≤1 msg/s/device, forced republish 60 s after last publish (single `setTimeout` per device, not polling).
- Heartbeat: one `setInterval(30 s)` publishing `status` to both (constitution IV allowed exception).

## R8. Dev cloud broker (replaces EMQX locally)
- **Decision**: `tools/dev-cloud-broker` = aedes + `net` (tcp 1884) + `ws` (8084, plain, upgrades accepted on any path incl. `/mqtt` — 002 default `ws://localhost:8084/mqtt`). No auth. `aedes.on('publish')` for topics matching `t/+/h/+/status` (including retained clears and LWT) → `POST http://127.0.0.1:3000/v1/emqx/webhook` `{topic, payload, publish_received_at}` with `X-EMQX-Token: $EMQX_SHARED_TOKEN` (dev `dev-token`). Retries 3× on connection refused (api may start later). Exported as a library too so tests can embed it on random ports.
- Optional flag `DEV_BROKER_HUB_AUTH=1` calls api `/v1/emqx/auth|acl` for `hub:` usernames (exercise FR-A04 locally, off by default).

## R9. Automation engine (FR-H08, post M-Local)
- **Decision**: pure, clock-injected core (`automation/engine.ts`) with `Clock` + `TimerHost` interfaces so Vitest fake timers drive edge/`for`/delay deterministically. Index `Map<"dev.prop", CompiledRule[]>`; `prev` seeded from registry at load. `croner` (timezone = site tz) for schedule; `suncalc` for sun, recomputed daily 00:05 site tz. Runs: sequential actions, cancellable delay, `RunProgress` per step change, `rules.lastRunAt/lastResult` coalesced ≤1 write/10 s/rule.
- Missed schedule after reboot: `TODO-OQ-6`.

## R10. History & LAN API
- **Decision**: better-sqlite3, WAL, single file `<dataDir>/hub.db`; migrations as numbered SQL strings applied at boot. History write throttle ≤1 row/10 s/property; hourly cleanup via `croner` (`0 * * * *`). Bucketed avg via `GROUP BY ts / (step*1000)`. `history.get` ack ≤300 points, answer ≤2 s.
- LAN: Fastify 5 + `@fastify/static` serving `lan.webDir` (default `apps/web/dist-lan`, `TODO-OQ-7`), private-IP guard hook (RFC1918 + loopback + link-local), `/setup` server-rendered HTML + `qrcode` SVG.

## R11. Packaging (FR-H12, last)
- Windows: esbuild → single CJS bundle → Node SEA (`node --experimental-sea-config`, postject). Native `better_sqlite3.node` and `@serialport/bindings-cpp` prebuilds shipped next to the exe and loaded by absolute path; `node.exe` shipped for Z2M; **winsw** service wrapper (XML, no native deps) chosen over node-windows. `install.ps1`: copy, `winsw install`, `powercfg -change standby-timeout-ac 0`, `New-NetFirewallRule -Profile Private` 8080/9001, COM detection (R2).
- Linux: `docker-compose.yml` (mosquitto, zigbee2mqtt pinned images, hub-agent image), `install.sh` (user, udev/by-id, systemd unit wrapping compose).
- `installers/versions.json` pins Z2M 2.14.2 and Mosquitto 2.0.22; `scripts/fetch-tools.mjs` (main) populates `.tools/`. Hub resolves `DN_TOOLS_DIR` → else `<repoRoot>/.tools`.

## R12. Infra (write only, never apply)
- Terraform (google provider): VM e2-small Debian 12 + startup script running compose (EMQX 5.8 OSS + Caddy), firewall, Cloud Run service (min 0 / max 2), Firestore native + TTL on `events.expireAt` (`TODO-OQ-4`), Hosting site, Secret Manager secrets. EMQX `cluster.hocon` per spec §5 (`disconnect_after_expire = false`, tcp/ws listeners disabled). Validation: `terraform fmt -check` + `terraform validate` only if terraform is installed (skipped otherwise).

## R13. Testing strategy
- Vitest everywhere. Brokers: aedes on ephemeral ports (dev-cloud-broker library). Z2M: mock-z2m. Firestore: `ConfigStore` interface with an in-memory fake for hub unit tests; api + rules tests run under `firebase emulators:exec --only auth,firestore` (`@firebase/rules-unit-testing` for rules). Engine/scheduler: fake timers + `TZ`-independent tz handling via croner `timezone`.
- One smoke script `tools/smoke/local.mjs` (< 30 s) against a running `pnpm dev` stack: api `/healthz`, hub `/api/health`, LAN WS publish `set` → wait `state`. No long-running e2e.

## R14. Dev orchestration
- **Decision**: `tools/dev/run.mjs` (plain Node, no `concurrently`): starts in order with TCP readiness waits — firebase emulators → api (`tsx watch`) → dev-cloud-broker → hub-agent (`DN_EMULATOR=1`, `DN_MOCK_Z2M=1` unless `--real`) → `pnpm --filter @devicenet/web dev` (only if `apps/web` exists; 002 owns its script). Prefixed, coloured output; Ctrl+C kills the tree (Windows `taskkill /T`).
