# Feature Specification: 001 – Backend (hub-agent + Cloud API + infra)

**Feature Branch**: `001-backend-hub-cloud` · **Created**: 2026-10-17 · **Status**: Draft · **Depends on**: `specs/000-shared-contracts` (phải merge trước)
**Input**: PRD, Tech Description, Design Spec, Wireframes DeviceNet; `docs/realtime-and-events.md`; `.specify/memory/constitution.md`

> Phạm vi: `apps/hub-agent`, `apps/api`, `infra/`, `installers/`. Frontend ở spec 002. Mọi payload/schema tham chiếu `packages/shared` — **không định nghĩa lại trong spec này**.

---

## 1. Tổng quan

Hub-agent là tiến trình Node 22 chạy như service cạnh Zigbee2MQTT + Mosquitto, dịch thiết bị Zigbee sang Property chuẩn, thực thi automation, serve trang LAN, và bridge có chọn lọc lên EMQX. Cloud API (Cloud Run/Fastify) chỉ làm: bootstrap tenant, claim hub, cấp credential, EMQX auth/acl cho hub, webhook mirror. Infra: EMQX 5 OSS + Caddy trên 1 VM, Firestore, Firebase Auth/Hosting, Cloud Run.

## 2. User stories phủ (từ PRD)
US-02 claim hub · US-03 pairing · US-04 state realtime · US-05 set/confirm · US-09/10/11 automation · US-12 LAN · US-13 history · US-14 remove device · US-15 hub liveness · US-16 event log. (US-01, 06, 07, 08-UI ở spec 002; US-08 phần chạy scene ở đây.)

## 3. Yêu cầu chức năng — hub-agent

### FR-H01 Khởi động & supervisor
- Đọc `config.yaml` (`serialPort` theo `/dev/serial/by-id/*` hoặc `VID:PID 10C4:EA60`/`1A86:55D4` trên Windows; `dataDir`; `lan.enabled`, `lan.bind`), khởi chạy Mosquitto rồi Zigbee2MQTT (tiến trình con), chờ `zigbee2mqtt/bridge/state == online` tối đa 60 s.
- Watchdog: tiến trình con chết → restart backoff 2→30 s; > 3 lần/10 phút → publish `events hub.warning code=child_crashloop` và tiếp tục thử.
- Log pino JSON xoay vòng 7 ngày trong `dataDir/logs`. **Không log payload** `set`/`state` ở mức info (debug mới có).
- Health: `GET /api/health` (hub-lan.openapi.yaml).

### FR-H02 Claim (chưa có credential)
- Sinh cặp khóa X25519 (libsodium `crypto_box_seal`) lưu `dataDir/hub.key` 0600; `POST /v1/hubs/claim-codes`; in mã ra console + `/setup` (QR `devicenet://claim?code=`); poll credential mỗi 3 s; hết 15 phút → lấy mã mới.
- Nhận credential → giải mã → `credentials.json` 0600 `{tenantId, hubId, siteId, mqtt, firebaseCustomToken, apiBaseUrl}` → chuyển trạng thái **claimed** không cần restart.
- Lệnh CLI `devicenet-agent reset`: xóa credentials + hub.key, giữ Z2M database (thiết bị không mất), quay về bước lấy mã.

### FR-H03 Driver zigbee2mqtt (interface chung `Driver`)
```ts
interface Driver {
  id: "zigbee2mqtt";
  start(): Promise<void>; stop(): Promise<void>;
  onDeviceDiscovered(cb: (d: DiscoveredDevice) => void): void;   // bridge/devices + interview_successful
  onState(cb: (externalId: string, raw: Record<string, unknown>) => void): void;
  onAvailability(cb: (externalId: string, online: boolean) => void): void;
  setProperty(externalId: string, key: PropertyKey, value: PropertyValue, prop: Property): Promise<void>;
  startPairing(seconds: number): Promise<void>; stopPairing(): Promise<void>;
  removeDevice(externalId: string, force: boolean): Promise<void>;
  rename(externalId: string, friendlyName: string): Promise<void>;
  ping(externalId: string): Promise<void>;                       // bridge/request/device/... hoặc /get {state:""}
  buildProperties(exposes: unknown[]): PropertyMap;              // theo data-model.md §4
  toDriverValue(prop: Property, v: PropertyValue): unknown;      // boolean → "ON"/"OFF"
  fromDriverValue(prop: Property, raw: unknown): PropertyValue;  // "ON" → true
}
```
- Hub-agent là **client duy nhất** subscribe `zigbee2mqtt/#` trên Mosquitto; ACL Mosquitto chặn client khác đọc `zigbee2mqtt/#`.
- `friendly_name` Z2M đặt = `dev_<ULID>` ngay khi tạo device (ổn định, không dấu); `device.rename` chỉ đổi `description` Z2M, **không** đổi friendly_name (tránh đổi topic Z2M). *(Điều chỉnh so với Tech: an toàn hơn.)*
- Availability: bật `availability: {active: {timeout: 10}, passive: {timeout: 1500}}` trong Z2M config do installer sinh.
- Reporting: installer cấu hình `device_options` mặc định; không chỉnh `reporting` ở v1 (câu hỏi mở PRD).

### FR-H04 Registry & state publish
- `core/registry`: Map deviceId → {device doc, values, at, online, lastSeen}. Nguồn sự thật tại chỗ; ghi SQLite `devices` khi đổi để khởi động lạnh có dữ liệu.
- Mỗi `onState` → merge values (chỉ key thuộc `properties`), cập nhật `at[key]` cho key đổi, `lastSeen` → đánh giá rule → publish `DeviceState` retained lên **cả** Mosquitto local và EMQX theo debounce §2.5 của `docs/realtime-and-events.md` → ghi history numeric.
- Khi device `removed` → publish retained rỗng.

### FR-H05 Lệnh từ app
- Subscribe `t/{t}/h/{h}/d/+/set` và `t/{t}/h/{h}/cmd` trên **cả hai** broker (LAN và cloud).
- `set`: validate từng key với `validateValue` + `isWritable`; sai → `events set.rejected` và bỏ cả message; đúng → queue theo deviceId → `driver.setProperty` → chờ `state` mới (Z2M báo) — **không** tự publish state giả.
- `cmd`: parse `CommandEnvelope`; sai schema → ack `invalid`. Xử lý theo bảng `Command` trong `mqtt.ts`. `pairing.start` khi đang active → ack `busy` kèm `expiresAt` hiện tại. Ack luôn trong ≤ 5 s (nếu driver chậm hơn → ack `timeout`).
- Dedupe `cmd.id` trong 60 s (QoS1 lặp).

### FR-H06 Pairing
- `pairing.start` → `zigbee2mqtt/bridge/request/permit_join {time}` → publish `PairingState` retained `{active:true, startedAt, expiresAt}`; timer nội bộ tới `expiresAt` → publish `{active:false}` và gọi permit_join `false` để chắc chắn.
- `interview_successful` → `buildProperties` → tạo Device (D-03) `status:"new"`, `name` = `description || model`, `primaryProperty` = sensor numeric đầu tiên theo ưu tiên `[power, temperature, humidity, illuminance, energy]`, `toggleProperty` = binary writable đầu tiên → Firestore `devices/{id}` → `events device.found` → `pairing.found += id` → publish `state` ban đầu (gọi `/get` nếu Z2M chưa báo).
- Thiết bị **đã có** trong Z2M nhưng chưa có trong Firestore (khôi phục sau reset cloud): lúc start, với mỗi device trong `bridge/devices` không có trong registry → tạo như trên với `status:"new"`.

### FR-H07 Sync Firestore (client SDK + custom token, D-06)
- `signInWithCustomToken` lúc có credential; token refresh tự động; `auth/invalid-user-token` → `POST /v1/hubs/{id}/token` với hub secret → signIn lại.
- Listeners: `rules`, `scenes` (where `hubId == me`), `devices` (where `hubId == me`), `sites/{siteId}`. Diff theo `rev`.
- Ghi: `devices` (fields hub sở hữu), `rules/scenes {appliedRev,lastRunAt,lastResult,brokenReason}`, `events` (set merge theo id), `hubs/{me}` fields liveness (tùy chọn; mirror webhook là chính).
- Offline: SDK cache; đồng thời ghi snapshot `config.json` vào SQLite sau mỗi thay đổi để `/api/config` và engine khởi động lạnh không mạng.

### FR-H08 Automation engine
- Theo `docs/realtime-and-events.md` §5. Rule biên dịch thành closure; index theo `dev.prop`; `for` bằng timer hủy được; cạnh lên; `prev` khởi tạo từ state hiện tại lúc nạp.
- Scheduler: `croner` với `timezone = site.timezone`; `sun`: `suncalc` từ `site.lat/lng`; thiếu lat/lng → rule `broken` với `brokenReason="site_missing_coordinates"`.
- Conditions: `all`/`any` lồng 1 cấp; `timeWindow` qua đêm; `sun` theo giờ hiện tại.
- Actions tuần tự với `RunProgress`; `setProperty` qua cùng queue như `set`; `runScene` tối đa 1 cấp; `notify` → `events notify` (+ Firestore events).
- `rule.enabled=false` giữa run → `cancelled`. Rule tham chiếu device `removed`/property thiếu → `lastResult="broken"`, `brokenReason`, `events rule.broken`; rule hợp lệ lại (device mới cùng id không xảy ra) → người dùng phải sửa.
- `actions.test` chạy như scene không lưu, `source.kind="test"`.

### FR-H09 History SQLite
- Bảng `history(device_id, property, ts, value)` index `(device_id, property, ts)`; giữ 7 ngày; dọn mỗi giờ. Bảng `events` giữ 30 ngày. `GET /api/history` bucket avg theo `step`.

### FR-H10 Bridge cloud
- Hai client mqtt.js: local (`mqtt://127.0.0.1:1883`, user `hub`), cloud (`mqtts://<vm>:8883`, user `hub:{hubId}`, `clientId hub-{hubId}`, `clean:false`, keepalive 30, LWT = `hubLwt()` retained trên `status`). Reconnect backoff 1→60 s.
- Forward: chỉ topic `t/{tenant}/h/{hubId}/#` chiều lên; chiều xuống nhận `set/cmd` từ cả hai; **không** forward `zigbee2mqtt/#`.
- Kết nối lại cloud → republish toàn bộ `state` retained + `status` + `pairing`.
- Heartbeat `status` mỗi 30 s (cả hai broker).

### FR-H11 LAN web
- Fastify static serve `apps/web` build `lan` tại `/`; `/setup`; API theo `hub-lan.openapi.yaml`. Bind `0.0.0.0` nhưng middleware từ chối IP ngoài dải private (RFC1918) — v1 không auth.
- Mosquitto listener WS `:9001` không auth, ACL: `allow read t/#`, `allow write t/+/h/+/d/+/set`, `allow write t/+/h/+/cmd`, deny `zigbee2mqtt/#`.

### FR-H12 Đóng gói
- Linux: `docker-compose.yml` (mosquitto, zigbee2mqtt, hub-agent) + `install.sh` một dòng (tạo user, `/dev/serial/by-id`, systemd `devicenet.service`).
- Windows: Node SEA một exe + Mosquitto + Z2M bundled; `install.ps1` một dòng: tạo Windows Service (`node-windows`/`winsw`), `powercfg -change standby-timeout-ac 0`, firewall rule 8080/9001 cho Private network, phát hiện COM qua VID:PID.
- Khóa phiên bản Z2M/Mosquitto trong `installers/versions.json`.

## 4. Yêu cầu chức năng — Cloud API (`apps/api`)
Theo `api.openapi.yaml`. Bổ sung hành vi:
- **FR-A01 bootstrap**: idempotent; tạo `tenants/{t}`, `members/{uid}` owner, `sites/{s}` "Nhà" (timezone từ body hoặc `Asia/Ho_Chi_Minh`); set custom claims `{tenant, role:"user", acl:{pub:["t/<t>/h/+/d/+/set","t/<t>/h/+/cmd"], sub:["t/<t>/#"]}}`.
- **FR-A02 claim**: transaction trên `claimCodes/{code}`: kiểm tra format/expiry/used; tạo `hubs/{hubId}` + `hubs/{hubId}/private/secret {secretHash}`; mint custom token `{tenant, hubId, role:"hub"}`; mã hóa credential bằng `hubPubKey` (sealed box); ghi `credential`, `used=true`. Mã lỗi theo OpenAPI.
- **FR-A03 credential GET**: trả rồi xóa `credential` (single read); 410 nếu `expiresAt < now` hoặc đã lấy.
- **FR-A04 EMQX auth/acl (hub)**: `username` khớp `^hub:(hub_[0-9A-Z]{26})$`; so `sha256(password)` với `private/secret`; acl publish `t/{tenant}/h/{hubId}/#`, subscribe `t/{tenant}/h/{hubId}/d/+/set|cmd`. Cache 60 s in-memory.
- **FR-A05 webhook**: xác thực `X-EMQX-Token`; parse topic (`parseTopic`), Zod `HubStatus`; idempotent `(hubId, seq)`; ghi `hubs/{hubId}` {online,lastSeen,…}. Payload rỗng (retained clear) → bỏ qua.
- **FR-A06 delete hub**: xóa `private/secret`, EMQX REST `DELETE /api/v5/clients/hub-{hubId}`, devices `status="removed"`, rules/scenes `lastResult="broken"`.
- **FR-A07 hub token refresh**: xác thực hub secret → custom token mới.
- Bảo mật: mọi handler kiểm tra `token.tenant` khớp tài nguyên; rate limit `claim-codes` 10/h/IP, `claim` 20/h/uid; Fastify `@fastify/helmet`, CORS chỉ origin Hosting + `http://localhost:*` dev.

## 5. Infra (`infra/`)
- Terraform: VM e2-small Debian 12 + Docker Compose (EMQX 5.8 OSS, Caddy TLS `sslip.io` khi chưa có miền), firewall 8883/8084/443/18083(chỉ IP admin), Cloud Run (min instances 0, max 2), Firestore (native, TTL policy `events.expireAt`), Firebase Hosting, Secret Manager (`EMQX_SHARED_TOKEN`, `EMQX_ADMIN_KEY`).
- EMQX config (declarative `cluster.hocon`):
  - authn: (1) JWT — `use_jwks=true`, `endpoint=https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com`, `verify_claims {aud: <firebase-project-id>, iss: https://securetoken.google.com/<project-id>}`, `acl_claim_name=acl`, `disconnect_after_expire=false`; (2) HTTP → `/v1/emqx/auth` cho username bắt đầu `hub:`.
  - authz: JWT acl claim (ưu tiên) → HTTP `/v1/emqx/acl` → deny all. `no_match = deny`.
  - rule engine: `SELECT topic, payload, publish_received_at FROM "t/+/h/+/status"` → webhook; Phase 2 thêm `events`.
  - listeners: `ssl:8883`, `wss:8084` (Caddy terminate hoặc EMQX tự cert). Tắt `tcp:1883`, `ws:8083`.
- `firestore.rules` = copy từ contracts; `firestore.indexes.json`: `devices(hubId,status)`, `rules(hubId,enabled)`, `events(ts desc)`.

## 6. Non-functional
- Lệnh app→thiết bị p95 ≤ 1 s LAN / ≤ 2 s cloud (đo bằng `sentAt` trong cmd và `ts` ack; log histogram ở hub).
- Hub chạy 7 ngày liên tục; RAM hub-agent < 150 MB; CPU idle < 2% trên PC cũ.
- Mất WAN 1 giờ: 100% rule chạy; log không trùng khi về mạng (test bằng toggle network trong CI e2e với mock Z2M).
- Chi phí cloud < 15 USD/tháng.

## 7. Thứ tự implement (gợi ý cho `/plan`)
1. `packages/shared` từ contracts + test.
2. hub-agent: supervisor + driver Z2M với **mock Z2M** (`tests/mock-z2m` phát `bridge/devices`, `state` từ fixture TS011F) → registry → state publish lên Mosquitto → trang LAN tối thiểu.
3. api: bootstrap + claim + credential + emulator tests.
4. hub-agent: claim client, Firestore sync, bridge cloud, status/LWT; api webhook.
5. engine + scheduler + runs/events; history SQLite; `/api/history`.
6. installers Windows/Linux; chạy thử 7 ngày.

## 8. Edge cases phải có test
- Dongle đổi cổng COM sau reboot → vẫn nhận (serial-by-id / VID:PID).
- `set` tới device offline → `events set.rejected reason=device_offline` trong ≤ 1 s, không treo queue.
- Hai `set` liên tiếp `state:true` rồi `false` trong 100 ms → thiết bị kết thúc `false`, app nhận trạng thái cuối `false` với `seq` tăng dần (coalescing 200 ms theo docs/realtime-and-events §2.5).
- Rule `for=180`: giá trị dao động 4 W ↔ 6 W → không kích hoạt; ổn định < 5 W đủ 180 s → kích hoạt đúng một lần.
- Hub reboot lúc 23:00:30 với rule schedule 23:00 → không chạy bù, ghi `hub.warning`.
- Mã claim nhập sai 5 lần → vẫn 400 (không lock) nhưng rate limit theo uid.
- Credential GET hai lần → lần hai 410.
- Firestore offline lúc pairing → device vẫn tạo ở registry; ghi Firestore khi có mạng; `pairing.found` vẫn phát.

## 9. Open questions (ghi vào `open-questions.md` nếu phát sinh)
- Z2M `reporting` cho công suất (PRD) — đo thực tế với TS011F trước khi quyết.
- US-13 "cloud nếu remote": thay vì `snapshots` Firestore (Phase 2), v1 dùng cmd **`history.get`** qua MQTT → ack chứa ≤ 300 điểm (xem `mqtt.ts`). Hub-agent phải trả lời trong ≤ 2 s từ SQLite. Không cần Firestore snapshots ở Phase 1.
