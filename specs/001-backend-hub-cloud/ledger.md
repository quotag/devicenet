# Fact Ledger: 001 – Backend (hub-agent + Cloud API + infra + installers)

| L-### | category | fact (verbatim ids/numbers) | source § | covered-by |
|---|---|---|---|---|
| L-001 | config | Node 22 LTS runtime required for hub-agent | spec §1 | plan §Technical Context, T001 |
| L-002 | config | `config.yaml` controls `serialPort`, `dataDir`, `lan.enabled`, `lan.bind`, `lan.port` (default 8080) | spec §3 FR-H01 | data-model §1, T001, T015 |
| L-003 | config | Auto-detect serial port via VID:PID `10C4:EA60` (CP210x) or `1A86:55D4` (CH9102/CH340) on Windows | spec §3 FR-H01, FR-H12 | installers/windows/install.ps1, T016, T113 |
| L-004 | schedule | Supervisor watchdog restart backoff 2 s to 30 s on child crash | spec §3 FR-H01 | supervisor/child.ts, T017 |
| L-005 | business-rule | Crash loop detection: > 3 crashes within 10 minutes | spec §3 FR-H01 | supervisor/child.ts, T017 |
| L-006 | notification | Publish `events hub.warning code=child_crashloop` on crash loop | spec §3 FR-H01 | supervisor/child.ts, T017 |
| L-007 | retention | Pino JSON logs rotated daily, kept 7 days in `dataDir/logs` | spec §3 FR-H01 | log/index.ts, T018 |
| L-008 | nfr | No set/state payload logged at info level (debug only) | spec §3 FR-H01, §6 | log/index.ts, T118 |
| L-009 | api | Health check endpoint `GET /api/health` returns status of agent, z2m, mqtt, firestore, claim | spec §3 FR-H01 | lan/routes/health.ts, T020 |
| L-010 | business-rule | Hub generates X25519 key pair with libsodium `crypto_box_seal` stored in `dataDir/hub.key` mode 0600 | spec §3 FR-H02 | claim/keys.ts, T021 |
| L-011 | api | Request claim code via `POST /v1/hubs/claim-codes` | spec §3 FR-H02 | claim/claimClient.ts, T022 |
| L-012 | number | Claim code expires after 15 minutes (900 seconds) | spec §3 FR-H02, D-09 | claim/claimClient.ts, T022 |
| L-013 | number | Hub polls credential from cloud every 3 seconds | spec §3 FR-H02, D-09 | claim/claimClient.ts, T023 |
| L-014 | data-model | Decrypted credentials saved to `dataDir/credentials.json` mode 0600 `{tenantId, hubId, siteId, mqtt, firebaseCustomToken, apiBaseUrl}` | spec §3 FR-H02 | claim/credentials.ts, T024 |
| L-015 | state-machine | Transition from unclaimed to claimed state live without process restart | spec §3 FR-H02 | main.ts, T025 |
| L-016 | business-rule | CLI `devicenet-agent reset` erases credentials + hub.key, keeps Z2M db, restarts claim loop | spec §3 FR-H02 | cli.ts, T026 |
| L-017 | api | LAN setup reset endpoint `POST /setup/reset` clears credentials and transitions to unclaimed | spec §3 FR-H02 | lan/routes/setup.ts, T127 |
| L-018 | state-machine | Auto-unclaim listener on Firestore hub doc triggers `goUnclaimed()` when doc deleted or 401/404 | spec §3 FR-H02 | sync/firestoreStore.ts, main.ts, T127 |
| L-019 | business-rule | Hub is the sole subscriber to `zigbee2mqtt/#` on Mosquitto; Mosquitto ACL blocks other clients | spec §3 FR-H03 | supervisor/mosquitto.ts, T027 |
| L-020 | business-rule | Z2M friendly_name is set to `dev_<ULID>` upon pairing and never changed | spec §3 FR-H03, OQ-1 | drivers/zigbee2mqtt/driver.ts, T028 |
| L-021 | business-rule | Device rename only modifies Z2M `description`, preserving MQTT topic stability | spec §3 FR-H03, OQ-1 | drivers/zigbee2mqtt/driver.ts, T028 |
| L-022 | config | Z2M availability config: active timeout 10 min, passive timeout 1500 min | spec §3 FR-H03 | supervisor/z2m.ts, T029 |
| L-023 | data-model | Driver interface includes `knownDevices(): DiscoveredDevice[]` for device cache inspection | spec §3 FR-H03 | drivers/Driver.ts, T126 |
| L-024 | business-rule | Driver cache invalidation: `clearDeviceCache` and `clearFriendlyNameCache` on device leave/remove | spec §3 FR-H03 | drivers/zigbee2mqtt/driver.ts, T126 |
| L-025 | data-model | Registry maps deviceId to `{device, values, at, online, lastSeen}` in-memory and SQLite `devices` | spec §3 FR-H04 | core/registry.ts, store/devices.ts, T030 |
| L-026 | business-rule | On state event, merge values only for keys declared in `device.properties` | spec §3 FR-H04 | core/registry.ts, T031 |
| L-027 | number | Realtime coalescing window of 200 ms with monotonic `seq` per device | spec §3 FR-H04, §8 | core/publisher.ts, T032 |
| L-028 | notification | Removed device triggers publishing empty retained message to clear broker state | spec §3 FR-H04 | core/publisher.ts, T033 |
| L-029 | api | Subscribe to `t/{t}/h/{h}/d/+/set` and `t/{t}/h/{h}/cmd` on local and cloud brokers | spec §3 FR-H05 | bridge/bridge.ts, T034 |
| L-030 | validation | Validate all property set keys with `validateValue` and `isWritable`; reject on invalid | spec §3 FR-H05 | core/setQueue.ts, T035 |
| L-031 | notification | Rejection of set command publishes `events set.rejected` | spec §3 FR-H05 | core/setQueue.ts, T035 |
| L-032 | nfr | Offline device set rejected within ≤ 1 s without hanging the queue | spec §3 FR-H05, §8 | core/setQueue.ts, T035 |
| L-033 | number | Command acknowledgment timeout deadline is 5000 ms (ack timeout if slower) | spec §3 FR-H05 | core/commands.ts, T036 |
| L-034 | number | Deduplicate command ids across brokers within 60 seconds LRU window | spec §3 FR-H05 | core/commands.ts, T037 |
| L-035 | business-rule | `pairing.start` triggers Z2M permit_join `{time: seconds}` and publishes retained `PairingState` | spec §3 FR-H06 | core/pairing.ts, T038 |
| L-036 | state-machine | If pairing active, subsequent `pairing.start` returns ack `busy` with current `expiresAt` | spec §3 FR-H06 | core/pairing.ts, T038 |
| L-037 | business-rule | Pre-interviewed discovery: on `pairing.start`, scan `driver.knownDevices()` and emit `device.found` | spec §3 FR-H06 | core/pairing.ts, T124 |
| L-038 | business-rule | Primary property selection priority: `[power, temperature, humidity, illuminance, energy]` | spec §3 FR-H06 | core/pairing.ts, T039 |
| L-039 | business-rule | Toggle property selection: first binary writable control property | spec §3 FR-H06 | core/pairing.ts, T039 |
| L-040 | data-model | SQLite conflict resolution on re-pair: delete existing removed device records matching IEEE | spec §3 FR-H06 | store/devices.ts, T125 |
| L-041 | state-machine | Re-pairing device identity migration: update hubId and siteId if assigned to a new site/hub | spec §3 FR-H06 | core/pairing.ts, T124 |
| L-042 | api | Firestore sync using client SDK with custom token (claims tenant, hubId, role=hub) | spec §3 FR-H07, D-06 | sync/firestoreStore.ts, T040 |
| L-043 | api | Token refresh on auth expiration via `POST /v1/hubs/{id}/token` using hub secret | spec §3 FR-H07, OQ-5 | claim/tokenRefresh.ts, T041 |
| L-044 | business-rule | Config snapshot saved to SQLite `config_snapshot` after each change to support cold boot | spec §3 FR-H07 | store/snapshot.ts, T042 |
| L-045 | business-rule | Target state awareness: engine checks current registry state; skips action if target already reached | spec §3 FR-H08 | automation/engine.ts, T122 |
| L-046 | business-rule | Initial timer evaluation: arm duration timer on boot/recompile if trigger condition is currently satisfied | spec §3 FR-H08 | automation/engine.ts, T122 |
| L-047 | number | Chained timeouts: split delays exceeding `MAX_TIMEOUT_MS = 24 * 86_400_000` ms into chained segments | spec §3 FR-H08 | automation/scheduler.ts, T123 |
| L-048 | schedule | Scheduler evaluates cron expressions using `croner` with `site.timezone` (default Asia/Ho_Chi_Minh) | spec §3 FR-H08 | automation/scheduler.ts, T108 |
| L-049 | schedule | Sun calculations via `suncalc` using `site.lat/lng`; missing coordinates marks rule `broken` | spec §3 FR-H08 | automation/sun.ts, T109 |
| L-050 | notification | Missed schedule on reboot: fire time during downtime emits `hub.warning code=schedule_missed` | spec §3 FR-H08, OQ-6 | automation/scheduler.ts, T110 |
| L-051 | retention | SQLite `history` retains numeric sensor records for 7 days with hourly cleanup | spec §3 FR-H09 | store/history.ts, retention.ts, T082, T086 |
| L-052 | retention | SQLite `events` retains activity events for 30 days | spec §3 FR-H09 | store/events.ts, retention.ts, T085, T086 |
| L-053 | api | `GET /api/history/{deviceId}/{property}` queries bucketed average points with default step 300 s | spec §3 FR-H09 | lan/routes/history.ts, T083 |
| L-054 | api | MQTT cmd `history.get` returns ≤ 300 points within ≤ 2 seconds from SQLite | spec §3 FR-H09, §9 | core/handlers/history.get.ts, T084 |
| L-055 | config | Cloud MQTT connects with `clean:false`, keepalive 30 s, and LWT on `status` topic | spec §3 FR-H10 | bridge/mqttLink.ts, T050 |
| L-056 | number | Heartbeat status published every 30 seconds on both local and cloud brokers | spec §3 FR-H10 | bridge/heartbeat.ts, T051 |
| L-057 | api | LAN Web served on port 8080; private IP middleware rejects non-RFC1918 traffic | spec §3 FR-H11 | lan/server.ts, privateIpGuard.ts, T052 |
| L-058 | config | Mosquitto WS listener on port 9001 with anonymous ACL allowing read `t/#`, write `set`/`cmd` | spec §3 FR-H11 | supervisor/mosquitto.ts, T053 |
| L-059 | installer | Linux installer script `apps/web/public/agent/install.sh` and `installers/linux/install.sh` | spec §3 FR-H12 | installers/linux/install.sh, T114, T128 |
| L-060 | installer | Linux installer sets up Docker, Docker Compose, systemd service `devicenet-hub.service` | spec §3 FR-H12 | installers/linux/install.sh, T114, T128 |
| L-061 | installer | Windows installer script `apps/web/public/agent/install.ps1` and `installers/windows/install.ps1` | spec §3 FR-H12 | installers/windows/install.ps1, T113, T128 |
| L-062 | installer | Windows packaging script `scripts/package-agent-win.mjs` and SEA builder `build-sea.mjs` | spec §3 FR-H12 | scripts/package-agent-win.mjs, T112, T128 |
| L-063 | config | Windows installer configures AC sleep timeout: `powercfg -change standby-timeout-ac 0` | spec §3 FR-H12 | installers/windows/install.ps1, T113 |
| L-064 | config | Windows installer adds firewall rules for private profile ports 8080 and 9001 | spec §3 FR-H12 | installers/windows/install.ps1, T113 |
| L-065 | api | `POST /v1/tenants/bootstrap` creates tenant, member owner, and site "Nhà" idempotently | spec §4 FR-A01 | routes/tenants.ts, T055 |
| L-066 | permission | Bootstrap assigns custom claims `{tenant, role:"user", acl:{pub:[...], sub:[...]}}` | spec §4 FR-A01 | routes/tenants.ts, T055 |
| L-067 | api | `POST /v1/hubs/claim` verifies code, creates hub record, mints custom token, encrypts sealed box | spec §4 FR-A02 | routes/claim.ts, T056 |
| L-068 | api | `GET /v1/hubs/credential` returns credential once and deletes it (second attempt returns 410) | spec §4 FR-A03 | routes/credential.ts, T057 |
| L-069 | api | `POST /v1/emqx/auth` validates username `^hub:(hub_[0-9A-Z]{26})$` against sha256(secret) with 60 s cache | spec §4 FR-A04 | routes/emqxAuth.ts, T093 |
| L-070 | api | `POST /v1/emqx/acl` authorizes pub `t/{tenant}/h/{hubId}/#` and sub `.../d/+/set|cmd` | spec §4 FR-A05 | routes/emqxAcl.ts, T094 |
| L-071 | api | `POST /v1/emqx/webhook` validates `X-EMQX-Token` and mirrors status/LWT idempotently to Firestore | spec §4 FR-A05 | routes/webhook.ts, T058 |
| L-072 | api | `DELETE /v1/hubs/{id}` removes secret, kicks EMQX client, marks devices `removed`, rules `broken` | spec §4 FR-A06 | routes/hubDelete.ts, T095 |
| L-073 | number | API rate limits: `claim-codes` 10/h/IP, `claim` 20/h/uid (disabled under emulator) | spec §4 | server.ts, T059 |
| L-074 | deployment | GCP Production Deployment Runbook documented in `docs/runbook-gcp-deploy.md` | spec §5 | docs/runbook-gcp-deploy.md, T129 |
| L-075 | deployment | GCP topology: Cloud Run api, Firebase Auth/Hosting, Firestore Native + TTL, GCE VM for EMQX 5.8 | spec §5 | docs/runbook-gcp-deploy.md, infra/, T098-T101 |
| L-076 | nfr | End-to-end command latency p95 ≤ 1 s LAN / ≤ 2 s cloud measured via `sentAt` and ack `ts` | spec §6 | core/metrics.ts, T117 |
| L-077 | nfr | Hub-agent process memory usage < 150 MB and idle CPU < 2% | spec §6 | tools/soak/sample.mjs, T120 |
| L-078 | edge-case | Consecutive set true then false within 100 ms resolves to final false with increasing seq | spec §8 | test/automation/engine.test.ts, T080 |
| L-079 | edge-case | Rule with `for=180` oscillates between 4 W and 6 W without firing, fires once when stable < 5 W | spec §8 | test/automation/engine.test.ts, T080 |
| L-080 | edge-case | Reboot at 23:00:30 with rule at 23:00 does not catch up and logs warning | spec §8 | test/automation/scheduler.test.ts, T111 |
| L-081 | edge-case | Pre-interviewed Zigbee device discovered on pairing start and added to pairing found list | spec §8 | test/core/pairing.test.ts, T124 |
| L-082 | edge-case | Re-pairing device with existing removed record deletes tombstone to avoid SQLite UNIQUE collision | spec §8 | test/core/pairing.test.ts, T125 |
| L-083 | edge-case | Deleting hub on cloud triggers auto-unclaim and local reset to setup mode | spec §8 | test/claim/claimClient.test.ts, T127 |
