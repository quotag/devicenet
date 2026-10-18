# Dev environment chung (M-Local) — 001 và 002 phải dùng đúng bảng này

| Thành phần | Địa chỉ dev | Ghi chú |
|---|---|---|
| Firebase project | `demo-devicenet` | emulator-only (tiền tố `demo-` không cần project thật) |
| Auth emulator | `127.0.0.1:9099` | |
| Firestore emulator | `127.0.0.1:8085` | **không** dùng 8080 (trùng LAN hub) |
| Emulator UI | `127.0.0.1:4000` | |
| api (Fastify, `apps/api`) | `http://127.0.0.1:3000` | CORS `http://localhost:*` |
| Mosquitto local của hub (LAN broker) | tcp `1883` (user `hub`), ws `9001` (không auth, ACL theo FR-H11) | binary ở `.tools/mosquitto/` |
| Dev "cloud broker" (thay EMQX) | tcp `1884`, ws `8084` (ws thường, không TLS) | `tools/dev-cloud-broker` (aedes): không auth app; mirror publish `t/+/h/+/status` → `POST http://127.0.0.1:3000/v1/emqx/webhook` với `X-EMQX-Token` = env `EMQX_SHARED_TOKEN` (dev: `dev-token`) — thay EMQX Rule Engine |
| hub-agent LAN web/API | `http://<ip>:8080` | serve build `lan` của apps/web |
| web dev (cloud mode) | `http://localhost:5173` | `VITE_MODE=cloud`, env trỏ emulator + api + ws://localhost:8084 |
| Zigbee2MQTT | `.tools/zigbee2mqtt/` (phiên bản khóa trong `installers/versions.json`), adapter `ember` (Sonoff ZBDongle-E), port COM phát hiện qua VID:PID `10C4:EA60` / `1A86:55D4` | hub-agent spawn như tiến trình con |
| Mock Z2M | `tests/mock-z2m` (hoặc `apps/hub-agent/test/mock-z2m`) | fixture TS011F, dùng khi `DN_MOCK_Z2M=1` |

Lệnh:
- `pnpm dev` — emulators + api + dev-cloud-broker + hub-agent (mock Z2M mặc định) + web.
- `pnpm dev:real` — như trên nhưng hub-agent chạy Mosquitto + Z2M thật với dongle.
- Firestore emulator: hub dùng client SDK + `connectFirestoreEmulator`/`connectAuthEmulator` khi env `DN_EMULATOR=1`. api dùng Admin SDK với `FIRESTORE_EMULATOR_HOST`/`FIREBASE_AUTH_EMULATOR_HOST`. Custom token từ Admin SDK trên emulator → hub `signInWithCustomToken` vào Auth emulator được.
- Lưu ý emulator: custom claims (tenant, acl) set bằng Admin SDK có hiệu lực trên Auth emulator; Firestore rules emulator nạp từ `infra/firestore.rules`.
