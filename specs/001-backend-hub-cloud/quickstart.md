# Quickstart / validation guide — 001 Backend

Ports and env: `.orchestration/dev-env.md` (authoritative). Contracts: `specs/000-shared-contracts/`. Design of each step: `plan.md`.

## Prerequisites (Windows 11, once)
- Node 22 LTS, pnpm 9+, `npm i -g firebase-tools`, **JDK 21** on PATH (Firestore emulator).
- `.tools/mosquitto/` containing `mosquitto.exe`, `mosquitto_passwd.exe` (+ DLLs) — version per `installers/versions.json`.
- `.tools/zigbee2mqtt/` = Z2M 2.14.2 built (`node scripts/fetch-tools.mjs` / `pnpm tools:fetch`). `pnpm tools:check` verifies. In a git worktree set `DN_TOOLS_DIR` to the main checkout's `.tools`.
- `pnpm dev:real` only: Sonoff ZBDongle-E plugged in (VID:PID `1A86:55D4`/`10C4:EA60`), Tuya TS011F plug nearby.
- `pnpm install` at repo root.

## M-Local validation (the milestone gate)

| # | Action | Expected |
|---|---|---|
| 1 | `pnpm dev` (mock Z2M) or `pnpm dev:real` (dongle) | Prefixed logs: emulators ready (UI http://127.0.0.1:4000), api `:3000`, dev-cloud-broker `:1884/:8084`, hub-agent: Mosquitto up, Z2M `bridge/state online` ≤ 60 s, `CLAIM CODE: XXXXXXXX (hết hạn HH:mm)`, LAN `http://<ip>:8080`. |
| 2 | Open `http://127.0.0.1:8080/setup` | Code + QR `devicenet://claim?code=…`. `GET /api/health` → `claimed:false, z2m:"online", mqttLocal:true`. |
| 3 | PWA (`http://localhost:5173`, feature 002) → login (Auth emulator) | api `POST /v1/tenants/bootstrap` 200; emulator UI shows `tenants/*`, `members/*`, `sites/*`, claims on the user. |
| 4 | PWA S-10 enter code | `POST /v1/hubs/claim` 200 → hub log `claimed` ≤ 3 s → signIn emulator → cloud link connected → `status online` → dev broker → webhook → `hubs/{id}.online=true` ≤ 10 s total. `/api/health` `claimed:true, mqttCloud:true, firestore:true`. |
| 5 | PWA S-11 "Ghép" (dev:real: reset/pair TS011F; dev: mock emits interview) | ack `{expiresAt}`; retained `pairing.active=true`; Firestore `devices/dev_…` `status:"new"` with `state, power, voltage, current, energy, …`; `events device.found`; retained `state`. |
| 6 | Toggle tile (cloud ws 8084) and from the LAN page (`:8080`, ws 9001) | Plug clicks; new `state` with `values.state` flipped ≤ 2 s; no state published before Z2M reports. |
| 7 | Stop hub-agent (Ctrl+C on its process or kill) | Dev broker publishes LWT → webhook → `hubs.online=false`. Restart → online again, retained state republished. |

Smoke (stack from step 1 running, < 30 s): `pnpm smoke` → checks api `/healthz`, hub `/api/health`, LAN ws `set` → `state` round-trip on the first device (mock or real). Exit 0 = pass.

## Automated tests
| Command | Covers |
|---|---|
| `pnpm --filter @devicenet/hub-agent test` | driver exposes→Property (TS011F fixture), registry/publisher (seq, debounce), set queue + rejects, cmd dedupe/ack/timeout, pairing, bridge dual-broker + reconnect republish (aedes), claim client crypto, LAN API; later engine edge/`for`, scheduler Asia/Ho_Chi_Minh + sun, history. |
| `pnpm --filter @devicenet/api test` | unit: code gen, sealed box round-trip, webhook parsing, EMQX auth/acl. |
| `pnpm --filter @devicenet/api test:emu` | `firebase emulators:exec`: bootstrap idempotent, claim happy/expired/used/other-tenant, credential 200→410, token refresh, webhook online/LWT; `infra/firestore.rules` tests (tenant isolation, hub vs user columns). |
| `pnpm --filter @devicenet/dev-cloud-broker test` | mirror status → webhook (stub HTTP server). |
| `pnpm typecheck` / `pnpm test` | all packages. |
| `pnpm --filter @devicenet/infra validate` | `terraform fmt -check` + `validate` when terraform is installed; never `apply`. |
