# 000 – Shared contracts: data model & handshake FE ⇄ BE ⇄ Hub

> Nguồn sự thật cho mọi agent viết code. Khi code và tài liệu khác (PRD/Tech/Design) mâu thuẫn với thư mục `contracts/`, **contracts thắng**; sửa doc sau.
> Mã nguồn thật của package `packages/shared` được sinh từ `contracts/*.ts` (copy nguyên, không viết lại).

## 0. Quyết định đã chốt (D-xx) — agent không được tự đổi

| ID | Quyết định | Lý do | Ảnh hưởng |
|---|---|---|---|
| D-01 | Giá trị `binary` trên wire là **boolean** `true/false`; driver Z2M map ⇄ `ON/OFF` | Zod/rule đơn giản, không nhầm `"on"`/`"ON"`/`1` | `state.values`, `set.values`, rule `value`, tile toggle |
| D-02 | Layout tile lưu **theo `(siteId, filter)`**, `filter = "all" \| roomId`; `w ∈ {1,2}`, `h = 1` | Khớp wireframe sắp xếp (chip mờ = chỉ sắp trong filter hiện tại), US-06 | `layouts/{siteId}.filters[filter].tiles` |
| D-03 | **Hub sinh `dev_…`** (ULID) khi `interview_successful`; app sinh `rule_/scn_/site_/room_`; api sinh `tenant_/hub_` | Hub tạo được device kể cả khi cloud chập chờn; không chờ round-trip | ids.ts |
| D-04 | Tất cả thời gian trên wire là **epoch ms (number)**; `ts` do **hub** đóng dấu; app hiển thị "x giây trước" từ `ts` + `clockOffset` | Một kiểu thời gian duy nhất; không lệch múi giờ | mọi payload |
| D-05 | `set` **không có ack riêng**; xác nhận = `state` mới khớp giá trị; timeout rollback **3000 ms** (mục tiêu p95 ≤ 2 s theo US-05) | Ít message, đúng ngữ nghĩa "trạng thái thật" | FE optimistic |
| D-06 | Hub dùng **Firebase client SDK + custom token** (claims `tenant`, `hubId`, `role=hub`); **không** dùng Admin SDK ở hub | Security Rules mới có hiệu lực với hub | hub `sync/firestore`, api `/v1/hubs/{id}/token` |
| D-07 | `hubs.online` trong Firestore do **api webhook từ EMQX Rule Engine** ghi (mirror `status`), không phải hub và không phải Cloud Run subscribe MQTT | Cloud Run scale-to-zero; LWT chỉ tới MQTT | api `/v1/emqx/webhook` |
| D-08 | App auth MQTT bằng **Firebase ID token (JWT)**; ACL lấy từ custom claim **`acl`** `{pub[], sub[]}` do api set lúc bootstrap. Hub auth bằng HTTP auth/acl | Không cần webhook ACL cho app; thêm tenant không sửa EMQX | api bootstrap, EMQX config |
| D-09 | Mã claim: **8 ký tự base32 (bỏ 0/O/1/I), hiệu lực 15 phút, dùng 1 lần**; hub poll credential mỗi **3 s** | US-02 "hub online ≤ 10 s sau khi nhập mã" | api, hub, wireframe S-10 (sửa 10 → 15 phút) |
| D-10 | Device offline theo **Z2M `availability`** (active check, timeout 10 phút); hub chỉ forward | Không viết lại logic Z2M đã có | hub driver |
| D-11 | Hub offline: **LWT → `online:false` tức thì** trên MQTT; Firestore mirror qua D-07; heartbeat `status` 30 s để refresh `lastSeen` | US-15 | hub bridge, FE banner |
| D-12 | Pairing chỉ khi hub **có cloud** (Firestore là nguồn danh sách thiết bị); LAN page không có ghép ở v1 | Giảm phạm vi | S-11 |
| D-13 | `for`, `delay.seconds` là **giây** trên wire; UI nhập phút và quy đổi | Một đơn vị cho hub | rule.ts |
| D-14 | Tóm tắt rule 1 dòng dùng **`summarizeTrigger/summarizeAction`** trong shared, FE không tự viết | S-02, log, thông báo đồng nhất | rule.ts |
| D-15 | Prefs người dùng (ngôn ngữ, °C/°F, theme) lưu **local + `members/{uid}.prefs`** | Đồng bộ đa thiết bị | firestore.ts |
| D-16 | "Xóa tài khoản" **ẩn ở v1**; endpoint `DELETE /v1/tenants/me` giữ chỗ | Phạm vi MVP | S-40 |
| D-17 | S-40 bỏ toggle "Tự dùng LAN khi có thể" ở v1 (PWA HTTPS không fetch được `http://` LAN — mixed content); chỉ hiện địa chỉ + nút Mở | Kỹ thuật không làm được ở Phase 1 | S-40, Tech |

## 1. Thực thể và quan hệ

```
Tenant 1─n Member
Tenant 1─n Site 1─n Room
Tenant 1─n Hub   (hub.siteId → Site)
Tenant 1─n Device (device.hubId → Hub, device.roomId → Room|null, device.siteId → Site)
Device 1─n Property (nhúng trong device.properties{})
Tenant 1─n Scene  (scene.hubId → Hub thực thi; scene.siteId)
Tenant 1─n Rule   (rule.hubId → Hub thực thi; tham chiếu deviceId.property)
Tenant 1─1/site Layout
Tenant 1─n Event  (TTL 30 ngày)
```

Quy tắc bất biến:
- Một device thuộc đúng **một hub**; `hubId` không đổi suốt vòng đời (xóa rồi ghép lại = device mới).
- Rule/scene thuộc **một hub** (hub nào thực thi). v1 một hub nên FE điền `hubId` = hub duy nhất của site; v3 cho chọn.
- Rule chỉ tham chiếu `deviceId + property`; nếu device `removed` hoặc property không còn → hub set `lastResult="broken"`, không xóa rule.

## 2. Ba đường dữ liệu và ai được viết gì

| Dữ liệu | Đường đi | Ai ghi | Ai đọc |
|---|---|---|---|
| Giá trị property (state) | MQTT retained `…/d/{dev}/state` | hub | app (cloud/LAN), hub engine |
| Lệnh set / cmd | MQTT `…/set`, `…/cmd` | app | hub |
| Cấu hình (device meta, room, rule, scene, layout) | Firestore `onSnapshot` 2 đầu | app (presentation) / hub (driver-derived) — ma trận trong `firestore.ts` + `firestore.rules` | app, hub |
| Liveness hub | MQTT retained `status` + LWT → webhook → Firestore `hubs` | hub → api | app |
| Sự kiện / log | MQTT `events` (realtime) + Firestore `events` (bền, hub upload idempotent theo `evt_` id) | hub | app |
| Lịch sử numeric | SQLite hub, đọc qua `GET /api/history` (LAN) hoặc Phase 2 snapshots | hub | app |

**Không bao giờ**: ghi state vào Firestore; app nói chuyện trực tiếp với `zigbee2mqtt/#`; Cloud Run nằm trên đường điều khiển.

## 3. Luồng bắt tay (sequence) — agent code đúng theo thứ tự này

### 3.1 Claim hub (US-02, S-10)
```
hub   → api   POST /v1/hubs/claim-codes {hubPubKey}            → {code, expiresAt}
hub   : hiện code ở log + http://ip:8080/setup (QR devicenet://claim?code=)
hub   → api   GET  /v1/hubs/claim-codes/{code}/credential (poll 3 s) → 404 …
app   → api   POST /v1/hubs/claim {code, siteId, name}  [Bearer ID token]
api   : tạo hubs/{hubId}, secret, custom token; stage credential mã hóa; đánh dấu used
hub   → api   GET credential → 200 {credential} → giải mã → lưu credentials.json (0600)
hub   : signIn(customToken) → Firestore listener; connect EMQX (hub:{hubId}/secret) → publish status online (retained)
EMQX  → api   webhook status → Firestore hubs/{hubId}.online = true
app   : onSnapshot hubs/{hubId}.online === true → S-10 bước 3 "Hub đã online" (mục tiêu ≤ 10 s)
```
Lỗi: `INVALID_CODE` / `EXPIRED` / `ALREADY_USED` → S-10 "Mã sai"; `HUB_BELONGS_TO_OTHER_TENANT` → hướng dẫn `devicenet-agent reset`.

### 3.2 Ghép thiết bị (US-03, S-11)
```
app → hub   cmd {type:"pairing.start", seconds:120}  (id cmd_…)
hub → app   ack {id, ok:true, result:{expiresAt}}
hub → app   pairing (retained) {active:true, startedAt, expiresAt, found:[]}
app : CountdownRing = expiresAt − (now + clockOffset); mở S-11 giữa chừng vẫn đúng vì retained
Z2M → hub   bridge/event interview_successful
hub : tạo Device dev_… (status "new", properties từ exposes) → Firestore devices/{dev}
hub → app   events {type:"device.found", deviceId, model, vendor}; pairing.found += dev
hub → app   state (retained) cho device mới
app : onSnapshot devices where status=="new" → FoundDeviceCard
app : đặt tên/room/icon/primary → update device {name, roomId, icon, primaryProperty, status:"active"}
app → hub   cmd device.rename (chỉ để friendly_name Z2M đẹp; không bắt buộc)
hub : hết expiresAt → pairing {active:false}; nếu found rỗng → app hiện "hết giờ"
```

### 3.3 Điều khiển nhanh (US-05, F3)
```
app : store[dev].pending = {state:true}; UI đổi ngay
app → hub   set {values:{state:true}}
hub : validate (writable, type) → Z2M …/set {state:"ON"} → Z2M báo state → hub publish state (retained)
app : state.values.state === true → clear pending (≤ 2 s)
     | 3000 ms không khớp → rollback + toast "Không nhận được phản hồi"
     | events set.rejected → rollback + toast lý do
```
Hub xử lý `set` **tuần tự theo device** (queue per deviceId) để không race giữa LAN và cloud.

### 3.4 Lưu rule và chờ hub xác nhận (US-09/10, S-30)
```
app : validate Rule bằng Zod shared → Firestore rules/{id} {…, rev: rev+1, updatedAt}
hub : onSnapshot rules → biên dịch → nạp engine → update rules/{id}.appliedRev = rev
app : S-30 hiện "Đã lưu, hub đang nạp…" cho tới khi appliedRev === rev; quá 5 s → giữ badge "Đang đồng bộ" ở S-02 (không báo lỗi)
```
Offline hub: rule vẫn lưu ở Firestore; hub nạp khi có mạng. App **không** chờ ack qua MQTT cho rule.

### 3.5 Chạy scene (US-08) và "Chạy thử"
```
app → hub   cmd scene.run {sceneId} | actions.test {actions}
hub → app   ack {ok, result:{runId}}
hub → app   runs {runId, status:"running", total:4, steps:[…]} (mỗi khi 1 step đổi)
hub → app   runs {status:"ok"|"partial"|"failed"}; events scene.run
app : SceneCard "Đang chạy 2 / 4…" từ runs; tick 1 s khi ok
```

### 3.6 Hub mất kết nối (US-15)
```
EMQX : LWT → status {online:false} retained → app banner ngay (MQTT)
EMQX → api webhook → Firestore hubs.online=false, lastSeen → S-03 badge, S-01 "lần cuối 12:40"
hub  : khi nối lại → status online + republish toàn bộ state retained (seq tiếp tục tăng)
```

### 3.7 Xóa thiết bị (US-14, SH-4)
```
app : referencedIds(rules+scenes) → danh sách "Sẽ lỗi"
app → hub   cmd device.remove {deviceId, force: !online}
hub : Z2M bridge/request/device/remove → OK → devices/{id}.status="removed", removedAt
hub : rule/scene tham chiếu → lastResult="broken", brokenReason; events rule.broken
hub : xóa retained state (publish payload rỗng) 
app : onSnapshot → tile biến mất; tab Automate chấm đỏ
```

## 4. Ánh xạ Z2M `exposes` → Property (driver zigbee2mqtt)

| expose | Property | category | ghi chú |
|---|---|---|---|
| `switch.state` (ON/OFF, access 7) | `state` binary rw | control | D-01: boolean |
| `numeric power` W | `power` numeric r, precision 1 | sensor | |
| `numeric voltage` V | `voltage` numeric r, precision 0 | sensor | |
| `numeric current` A | `current` numeric r, precision 2 | sensor | |
| `numeric energy` kWh | `energy` numeric r, precision 1 | sensor | |
| `enum power_on_behavior` | enum rw | config | valueLabels {off:"Tắt",on:"Bật",previous:"Nhớ"} |
| `enum indicator_mode` | enum rw | control | wireframe S-20 |
| `binary child_lock` | binary rw | config | |
| `linkquality` | `linkquality` numeric r | diag | không lên tile |
| `battery` | `battery` numeric r % | diag | hiện ở Kỹ thuật |
| `temperature`/`humidity` | numeric r, precision 1 | sensor | |

Quy tắc: expose `access` bit 2 → writable (`accessFromZ2M`). `category` mặc định: writable binary/enum có tên trong {state, brightness, color_temp, indicator_mode, position} → `control`; writable khác → `config`; read-only numeric → `sensor` trừ {linkquality, battery, voltage_battery} → `diag`. Driver phải **giữ nguyên key** của Z2M (snake_case) để không cần bảng dịch.

## 5. Phiên bản & tương thích
- `MQTT_CONTRACT_VERSION = 1` trên mọi payload; thêm trường = không tăng version; đổi nghĩa/xóa trường = version mới và hub hỗ trợ cả hai trong 1 release.
- `@devicenet/shared` semver; app và hub log cảnh báo khi major khác nhau (status.agentVersion vs app build).
