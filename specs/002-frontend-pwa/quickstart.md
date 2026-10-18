# Quickstart: M-Local validation for `apps/web`

Ports and services are fixed by [`.orchestration/dev-env.md`](../../.orchestration/dev-env.md). Contracts: [`specs/000-shared-contracts`](../000-shared-contracts/). This is a run/validation guide, not implementation.

## Prerequisites
- Node 22, pnpm; `pnpm install` at repo root (with `packages/shared` built).
- 001 M-Local running: Firebase emulators (`demo-devicenet`, Auth 9099, Firestore 8085, UI 4000), api `:3000`, dev cloud broker (tcp 1884 / ws 8084, no auth, mirrors `status` → api webhook), hub-agent with mock Z2M (`DN_MOCK_Z2M=1`), LAN `:8080`, Mosquitto ws `:9001`.
- One command for everything: `pnpm dev` (root). Web alone: `pnpm --filter web dev` → http://localhost:5173.

## Env (`apps/web/.env.development`, cloud mode)
```
VITE_MODE=cloud
VITE_USE_EMULATOR=1
VITE_FIREBASE_PROJECT_ID=demo-devicenet
VITE_FIREBASE_API_KEY=demo-key
VITE_AUTH_EMULATOR_URL=http://127.0.0.1:9099
VITE_FIRESTORE_EMULATOR_HOST=127.0.0.1:8085
VITE_API_URL=http://127.0.0.1:3000
VITE_MQTT_URL=ws://localhost:8084/mqtt
```
`apps/web/.env.lan`: `VITE_MODE=lan` only (MQTT host derived from `location.hostname`, port 9001).

## Automated checks
```
pnpm --filter web test        # unit + aedes transport + component tests
pnpm --filter web typecheck
pnpm --filter web build       # cloud
pnpm --filter web build:lan   # → apps/web/dist-lan (served by hub-agent)
```

## Manual scenarios (M-Local exit)
| # | Steps | Expected |
|---|---|---|
| Q1 Login + bootstrap | Open :5173 → Google sign-in → emulator account chooser → add new account | `/v1/tenants/bootstrap` called once; token refreshed with `tenant`; redirect to `/onboarding/hub` (no hub). Emulator UI shows `tenants/{t}`, site "Nhà". |
| Q2 Claim hub | Start hub-agent unclaimed → read 8-char code from its log or http://127.0.0.1:8080/setup → S-10 step 2 → enter → "Kết nối" | Wrong code → error state (`S10-MaSai`); correct → step 3 reaches "Hub đã online" (Firestore `hubs/{id}.online` or MQTT `status`) ≤ 10 s. |
| Q3 Pairing | "Thêm thiết bị ngay" → S-11 | `pairing.start` ack; countdown from retained `pairing`; mock Z2M TS011F appears as FoundDeviceCard ("Mới"); leaving sends `pairing.stop`; let it expire with no device → `S11-HetGio` state. |
| Q4 Naming | Name device, pick room ("Room mới" creates one), icon, primary property → "Lưu" | Firestore device `status:"active"`, `device.rename` cmd sent; `/home` shows tile highlighted 2 s. |
| Q5 Toggle | Tap tile toggle | Spinner (pending) then on-state when hub `state` arrives. Stop hub-agent's Z2M mock reply (or hub) → after 3 s value rolls back + toast "Không nhận được phản hồi từ {tên}". |
| Q6 Banners | Kill hub-agent | LWT → banner hub offline ("lần cuối HH:mm"), toggles disabled. Kill dev broker → "Đang kết nối lại…"; restart → banner clears, state replays (no duplicates). |
| Q7 S-20 + LAN | Tap tile → S-20 shows controls/sensors with "cập nhật x trước". Open http://<lan-ip>:8080 | LAN build loads without login, banner "Đang dùng chế độ LAN · {ip}", toggle works with internet/broker 8084 stopped; S-10/S-11 not reachable. |

Troubleshooting: Firestore permission errors on app writes → check the ID token carries `role:"user"` (001 FR-A01 bootstrap). Prerequisite build: `pnpm --filter @devicenet/shared build`.
