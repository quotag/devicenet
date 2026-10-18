# Realtime & event triggers: Web app → Cloud → Hub (gần thời gian thực)

> Tài liệu bắt buộc đọc cho agent viết `apps/web/src/transport`, `apps/hub-agent/src/bridge`, `apps/hub-agent/src/automation`, `apps/api`.
> Mục tiêu đo được: lệnh app → thiết bị **≤ 1 s LAN, ≤ 2 s cloud (p95)**; state thiết bị → UI **≤ 1 s LAN, ≤ 2 s cloud**; rule lưu → hub nạp **≤ 2 s** khi online.

## 1. Bản đồ "cái gì đi đường nào" (ghi nhớ bằng một câu)

**Thứ gì phải nhanh thì đi MQTT; thứ gì phải bền thì đi Firestore; Cloud Run chỉ cấp phát bí mật và mirror.**

| Sự kiện | Đường | Cơ chế kích hoạt (trigger) | Độ trễ kỳ vọng |
|---|---|---|---|
| Bấm toggle | app → EMQX/Mosquitto → hub → Z2M | publish QoS1 `…/d/{dev}/set` | 100–400 ms |
| Thiết bị báo state | Z2M → hub → MQTT retained `state` → app | hub subscribe `zigbee2mqtt/+`; app subscribe `t/{tenant}/#` **một lần** | 100–500 ms |
| Lệnh hub (pairing, scene.run, remove…) | app → MQTT `cmd` → hub → `cmd/ack` | correlation `id`, timeout 5 s | < 1 s |
| Lưu rule/scene/đổi tên/room/layout | app → Firestore → hub `onSnapshot` | Firestore realtime listener (websocket/long-poll của SDK) | 300 ms – 2 s |
| Hub xác nhận đã nạp rule | hub → Firestore `appliedRev` → app `onSnapshot` | cùng listener | < 2 s |
| Hub chết | EMQX LWT → `status` retained → app; EMQX webhook → Cloud Run → Firestore | LWT (keepalive 30 s → phát hiện ≤ 45 s) | 0 – 45 s |
| Hub heartbeat | hub → `status` retained mỗi 30 s | timer ở hub (ngoại lệ polling hợp lệ) | – |
| Thiết bị offline/online | Z2M availability → hub → `state.online` + `events` | Z2M active check | theo Z2M (≤ 10 phút) |
| Automation chạy | Z2M state → hub engine → Z2M set; `events`+`runs` → app | event-driven trong hub, index theo `deviceId.property` | < 300 ms trong hub |

## 2. Kỹ thuật MQTT phải làm đúng

### 2.1 Subscribe một lần, dựa vào retained
- App sau khi có `tenant` claim: `client.subscribe('t/{tenant}/#', {qos:1})` **một lần**. Mọi `state`, `status`, `pairing` là retained nên ngay sau subscribe broker đổ về toàn bộ trạng thái hiện tại — **không cần REST "get all state"**.
- Khi reconnect (mqtt.js `reconnect` + `connect` event): subscribe lại; retained lại đổ về → store được đồng bộ. Không giữ `clean: false` session ở app (đơn giản, tránh queue tràn); hub thì `clean: false` + `clientId` cố định `hub-{hubId}` để không mất `set/cmd` trong vài giây đứt mạng.
- Hub xóa retained khi device removed: publish payload rỗng, retain=true vào `…/d/{dev}/state`.

### 2.2 Correlation và timeout
- `cmd`: app sinh `cmd_<ULID>`, lưu `pending[id] = {resolve, timer 5000}`; `ack` khớp `id` → resolve. Không có ack → UI báo "Hub không phản hồi" và **không giả định** lệnh đã chạy.
- `set`: không ack riêng (D-05). App so sánh `state.values[key]` với giá trị đã gửi cho **từng key**; `pending` chỉ xóa key đã khớp. Timeout 3000 ms theo từng key.
- Hub xử lý `set` **tuần tự theo device** (queue/`p-queue` concurrency 1 per deviceId) để lệnh từ LAN và cloud không chéo nhau; `cmd` xử lý song song trừ `pairing.*` (mutex).

### 2.3 Thứ tự và trùng lặp
- Mọi payload hub phát có `seq` tăng dần theo hub. App giữ `lastSeq[topic]`, bỏ qua message có `seq` ≤ đã thấy (QoS1 có thể lặp). `seq` reset về 0 khi hub khởi động → app chấp nhận `seq` nhỏ hơn nếu `ts` lớn hơn `lastTs + 60 s`.
- `events` upload Firestore idempotent bằng `evt_` id (merge set).

### 2.4 Đồng hồ
- Hub NTP-sync; mọi `ts` từ hub. App tính `clockOffset = hubStatus.ts − Date.now()` (median 5 mẫu gần nhất) và dùng cho đếm ngược pairing và "x giây trước". Không dùng `Date.now()` của điện thoại để so với `ts` hub mà không bù.

### 2.5 Debounce/throttle ở hub (bảo vệ cloud và pin)
- Ổ cắm báo 10–60 s một lần; hub **chỉ publish `state` khi có property đổi** hoặc đã 60 s kể từ lần cuối; giới hạn 1 msg/s/device (gộp thay đổi trong cửa sổ 200 ms thành một snapshot).
- `history` SQLite ghi mỗi thay đổi numeric nhưng không quá 1 dòng/10 s/property.
- Firestore: **không bao giờ** ghi state; `rules.lastRunAt/lastResult` ghi tối đa 1 lần/10 s/rule (gộp).

### 2.6 Token hết hạn
- Firebase ID token sống 1 giờ. App: `onIdTokenChanged` → nếu MQTT đang nối, **không ngắt**; lưu token mới làm `password` để lần reconnect kế dùng. EMQX JWT auth chỉ kiểm tra lúc CONNECT (không ngắt khi `exp` qua, trừ khi bật `disconnect_after_expire` — **phải tắt** tùy chọn này trong EMQX). Nếu bật nhầm, app sẽ bị ngắt mỗi giờ.
- Hub: custom token Firebase cũng sống 1 giờ; SDK tự refresh bằng refresh token nên **chỉ cần signIn một lần**; gọi `/v1/hubs/{id}/token` chỉ khi `auth/invalid-user-token` (secret bị xoay).

### 2.7 QoS/retain (xem `topicPolicy` trong `mqtt.ts`)
`status/state/pairing`: QoS1 retain · `set/cmd/ack/runs`: QoS1 · `events/history`: QoS0. Không dùng QoS2.

## 3. Firestore listener phải làm đúng

- App: một `onSnapshot` cho mỗi collection trong tenant (`devices`, `rooms` theo site, `rules`, `scenes`, `layouts/{site}`, `hubs`, `events` limit 50). Bật `persistentLocalCache` (IndexedDB) để Home hiện ngay khi offline (đánh dấu mờ).
- Dùng `includeMetadataChanges: false`; với ghi của chính mình dùng optimistic UI từ SDK (latency compensation) — **không** chờ server.
- Hub: `onSnapshot` cho `rules`, `scenes`, `devices` (chỉ fields presentation để đổi `friendly_name`), `sites/{siteId}` (timezone/lat/lng). Mỗi snapshot → diff theo `rev`; chỉ biên dịch lại rule có `rev > appliedRev`. Ghi `appliedRev` ngay sau khi nạp (batch cho nhiều rule).
- Hub offline Firestore: SDK tự queue ghi; đọc từ cache. Hub **còn** ghi `config.json` SQLite snapshot sau mỗi thay đổi để LAN `/api/config` phục vụ khi chưa có cache SDK (khởi động lạnh không mạng).
- `rev` do app tăng (`rev + 1`, Rules bắt buộc). Hai thiết bị sửa cùng lúc: bản sau thắng; app so `updatedAt` để hiện "đã có bản mới hơn" nếu đang mở S-30.

## 4. Pairing và các countdown
- Nguồn thời gian là `pairing.expiresAt` (hub). App: `remaining = expiresAt − (Date.now() + clockOffset)`; render mỗi 250 ms bằng `requestAnimationFrame`/`setInterval` cục bộ **chỉ để vẽ**, không hỏi hub.
- Hub tự publish `pairing {active:false}` khi hết giờ hoặc nhận `pairing.stop`; nếu Z2M báo permit_join đổi trạng thái → cũng publish.
- Danh sách thiết bị tìm thấy đến từ **Firestore `devices` status "new"** (bền, có properties); `events device.found` chỉ để toast/âm báo và cập nhật `pairing.found`.

## 5. Automation engine (trong hub) — event-driven, không vòng lặp
- Trigger `property`: index `Map<"dev.prop", Rule[]>`; mỗi `state` đổi → lấy đúng rule liên quan → đánh giá biểu thức → **cạnh lên**: `prev=false && now=true` → nếu `for` thì `setTimeout(for*1000)` (hủy nếu trở lại false) → chạy.
- Trigger `schedule`: `node-cron`/`croner` với `timezone = site.timezone`; tính lại khi site đổi. Trigger `sun`: `suncalc` theo `lat/lng`; mỗi ngày 00:05 tính lại giờ mọc/lặn → đặt timer.
- Run: `run_` id, actions tuần tự; `delay` dùng timer hủy được; rule bị `enabled=false` hoặc `rev` đổi giữa chừng → `cancelled`. `runs` publish mỗi lần một step đổi trạng thái.
- Khởi động lại hub: không "chạy bù" trigger đã lỡ (schedule) ở v1 — ghi `hub.warning` nếu lỡ > 1 lần chạy; property trigger khởi tạo `prev` từ state retained hiện tại để **không** kích hoạt giả ngay lúc boot.

## 6. Những lỗi kinh điển agent hay mắc — CẤM
1. Viết state vào Firestore "cho tiện" → chi phí và chậm. **Cấm.**
2. REST endpoint `/devices/{id}/toggle` ở Cloud Run → thêm hop, mất LAN. **Cấm.**
3. `setInterval` hỏi `/state` hoặc đọc Firestore theo chu kỳ. **Cấm** (trừ LAN `/api/config` 30 s và heartbeat hub).
4. Dùng Admin SDK ở hub. **Cấm** (D-06).
5. Cloud Run giữ kết nối MQTT thường trực để mirror. **Cấm** (D-07) — dùng EMQX Rule Engine webhook.
6. App nối thẳng `zigbee2mqtt/#` hoặc hub publish topic Z2M lên cloud. **Cấm.**
7. Tự tạo kiểu/schema trong app thay vì import `@devicenet/shared`. **Cấm.**
8. Hiển thị "Bật" khi chỉ mới gửi `set` mà chưa nhận `state`, hoặc không rollback sau 3 s. **Cấm.**
9. So sánh `ts` hub với giờ điện thoại không bù `clockOffset`. **Cấm.**
10. Dùng `Date`/ISO string trên wire, hoặc phút thay vì giây trong rule. **Cấm.**
11. Bật `disconnect_after_expire` trong EMQX JWT auth. **Cấm.**
12. Bỏ `seq`/`id` dedupe vì "QoS1 là đủ". **Cấm.**
