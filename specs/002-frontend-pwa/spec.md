# Feature Specification: 002 – Frontend PWA (`apps/web`)

**Feature Branch**: `002-frontend-pwa` · **Created**: 2026-10-17 · **Status**: Draft · **Depends on**: `000-shared-contracts` (bắt buộc), `001-backend-hub-cloud` (có thể dev song song với mock)
**Input**: PRD, Design Spec, **Design "DeviceNet – Wireframes"** (34 artboard; nguồn https://claude.ai/artifact/4DL1hLUTNtHsJZdr2ACb1W, bản local `design/`, phiên bản `1792254951-200a`), DeviceNet design system (`design/ds/devicenet/tokens.json`), `docs/realtime-and-events.md`
**Cập nhật**: 2026-10-17 — đối chiếu với Design: thêm SH-3 (FR-F10), Desktop 1280 (FR-F11), bảng artboard (§4.0), sửa chuỗi §8, cập nhật open questions §10. Cùng ngày: chốt OQ-3..OQ-9, bổ sung Design (SH-5, SH-6, chi tiết hub, lịch sử, toast, desktop màn khác), Design chưa phải bản cuối ở bước plan.

> Mọi chuỗi UI tiếng Việt lấy **đúng nguyên văn** từ Design (liệt kê ở §8). Mọi kiểu dữ liệu import từ `@devicenet/shared`. Component đặt tên **trùng** Design Spec §Component library và design system (`DeviceNet.*`).
>
> **Bắt buộc với mọi agent/task làm UI (constitution VIII):** Design **chưa phải bản cuối** ở bước `/plan`, `/tasks`: chỉ dùng để xác định màn/state/component, mỗi task UI ghi rõ artboard nó dựng (bảng §4.0), không chép chi tiết pixel vào plan. Ở `/implement`: kiểm tra phiên bản canvas (`design/README.md`), tải lại nếu đổi, rồi bám sát artboard. Màn/state không có artboard, hoặc không đọc được file design → **dừng, ghi `specs/002-frontend-pwa/open-questions.md`, báo người phụ trách**; không tự nghĩ ra bố cục, màu, chuỗi. Design thắng spec về giao diện + chuỗi; spec/contract thắng về dữ liệu + hành vi.

---

## 1. Tổng quan
Một code base React 19 + Vite 6 + TypeScript build hai biến thể bằng `VITE_MODE=cloud|lan`. Khác nhau **chỉ** ở lớp `transport/` (MQTT endpoint + nguồn config). 3 tab (Home, Automate, Me) + 7 màn phụ + 4 sheet/dialog theo Bản đồ màn hình của Design Spec. Mobile 390 ưu tiên; desktop 1280 chỉ Home (4 cột) và Rule Editor (2 cột) theo artboard `D-Home`, `D-RuleEditor` (FR-F11), làm sau cùng.

## 2. User stories phủ
US-01 login/bootstrap · US-02 S-10 · US-03 S-11 · US-04/05 Home realtime + optimistic · US-06 layout · US-07 room · US-08 scene · US-09/10 S-30 · US-12 S-40 LAN · US-13 S-20 + chart · US-14 xóa (SH-4) · US-15 banner/badge · US-16 log.

## 3. Kiến trúc FE (bắt buộc theo cấu trúc Tech)
```
apps/web/src
  app/            router (TanStack), providers (Auth, Firestore, Mqtt, Theme), TabLayout
  features/home | automate | me | onboarding | device
  transport/
    MqttClient.ts        // cloud: wss://<vm>:8084, username=uid, password=idToken | lan: ws://<hubip>:9001 no auth
    ConfigSource.ts      // cloud: Firestore onSnapshot | lan: GET /api/config poll 30 s
    HubCommands.ts       // sendCommand(cmd) → Promise<CommandAck> (timeout 5 s), setValues(deviceId, values)
    HistorySource.ts     // lan: GET /api/history | cloud: cmd history.get
  stores/ deviceState (values, at, online, pending), connection (mqtt status, hubStatus, clockOffset), ui (arrange mode, filter, theme)
  lib/ firebase.ts, api.ts (OpenAPI client sinh từ api.openapi.yaml), format.ts (số kiểu vi-VN, "x giây trước"), i18n/vi.ts
```
Quy tắc:
- `transport/` là **nơi duy nhất** import `mqtt` và `firebase/firestore`. Feature chỉ dùng hooks `useDeviceState(id)`, `useDevices()`, `useRules()`, `useHub()`, `useSendCommand()`.
- Zustand selector theo `deviceId` để `DeviceTile` không re-render khi tile khác đổi.
- Zod parse **mọi** message MQTT (`DeviceState`, `HubStatus`, `PairingState`, `RunProgress`, `HubEvent`, `CommandAck`) — message không parse được → `console.warn` + bỏ, không crash.
- Realtime Event Ingestion: `inbound.ts` bắt topic `t/{tenant}/h/{hubId}/events/+` và `devicenet/...`, parse `HubEvent` để hiển thị toast cảnh báo hoặc cập nhật lịch sử hoạt động tức thì.
- HTTP 304 Not Modified: `LanConfigSource` gửi header `If-None-Match` kèm ETag của snapshot trước; nhận 304 thì giữ nguyên store, tránh re-render thừa.

## 4. Yêu cầu chức năng theo màn

### 4.0 Artboard cho từng FR (`design/<tên>.dc.html`)
| FR | Artboard |
|---|---|
| FR-F00 S-00 | `Main` |
| FR-F01 S-01 | `S01-Home`, `S01-Offline` (mode offline/lan/reconnecting), `S01-SapXep`, `S01-Trong` (empty/roomEmpty/loading) |
| FR-F02 S-02 | `S02-Scene`, `S02-Automation`, `S02-Trong` (scene/automation) |
| FR-F03 S-03, S-40 | `S03-Me` (online/hubOffline/noHub, unnamed), `S03-ChiTietHub` (online/offline, confirm), `S03-LichSu` (data/empty), `S40-CaiDat` |
| FR-F04 S-10 | `S10-CaiAgent`, `S10-NhapMa`, `S10-MaSai`, `S10-KetNoi` |
| FR-F05 S-11 | `S11-TimThietBi`, `S11-DatTen`, `S11-HetGio` (bước 1 Chọn hub: tự hoàn tất, chỉ hiện ✓ trên Stepper) |
| FR-F06 S-20 | `S20-ChiTiet` (pending), `S20-Offline` |
| FR-F07 SH-4 | `SH4-XacNhanXoa` (step 1/2) |
| FR-F08 S-30 | `S30-RuleEditor`, `S30-ChuaHopLe`, `S30-ChonTrigger` |
| FR-F09 SH-1, SH-2 | `SH1-ChonSite`, `SH2-MenuThem` |
| FR-F10 SH-3 | `SH3-SuaNhanh` |
| FR-F11 Desktop | `D-Home`, `D-RuleEditor`, `D-ChiTiet` (dialog) |
| FR-F12 SH-5 Room/site | `SH5-SiteRoom` (edit/confirm/newRoom/newSite/pick) |
| FR-F13 SH-6 Sửa/xóa scene, automation | `SH6-XoaAutomation` (menu/confirm) |
| FR-F14 Toast | `S01-Toast` (timeout/error/update) |

Tên trong ngoặc = giá trị prop trong `data-props` của artboard để xem từng state.

### FR-F00 S-00 Đăng nhập (US-01)
- Cấu hình Firebase Auth: hỗ trợ biến môi trường `VITE_FIREBASE_AUTH_DOMAIN` (`firebaseAuthDomain`), khởi tạo `initializeApp` với `authDomain` mặc định `${projectId}.firebaseapp.com`.
- `signInWithGoogle`: ưu tiên `signInWithPopup` (desktop/web); tự động fallback sang `signInWithRedirect` khi popup bị chặn (`auth/popup-blocked`) hoặc trên iOS PWA standalone.
- Xử lý lỗi đăng nhập: âm thầm bỏ qua (không hiện toast lỗi) khi người dùng chủ động đóng popup (`auth/popup-closed-by-user`, `auth/cancelled-popup-request`). Các mã lỗi khác hiển thị toast kèm mã lỗi: `${vi.s00.error} (${code})`.
- Phiên làm việc (Session): `applyAuthUser` lưu trước `idToken` và thông tin `user` vào `sessionStore`, gửi kèm `Authorization: Bearer <idToken>` trong request `POST /v1/tenants/bootstrap` để xác thực Cloud Run; sau khi bootstrap hoàn tất sẽ làm mới token (`getIdToken(true)`) để nạp custom claims `tenant` và `role:"user"`.
- Điều hướng: tenant chưa có hub → `/onboarding/hub` (S-10); có → `/home`.
- States: mặc định, loading (nút), lỗi (toast). Đăng xuất: `signOut`, `terminate` Firestore + `clearIndexedDbPersistence`, ngắt MQTT, xóa Zustand.

### FR-F01 S-01 Home (US-04/05/06/07/15)
- Header: `SiteSwitcher` (SH-1) · nút + (SH-2). Banner `StatusBanner` khi `hubStatus.online=false` ("Hub {tên} đang offline · lần cuối {HH:mm}"), LAN build ("Đang dùng chế độ LAN · {ip}"), MQTT reconnecting ("Đang kết nối lại…").
- Điều hướng TabBar & DesktopShell: tab **Automate** tự động chuyển sang trạng thái disabled (mờ, không thể bấm, có tooltip giải thích) khi tài khoản chưa có hub nào (trạng thái onboarding). Sau khi hoàn tất claim hub, tab Automate kích hoạt bình thường.
- `RoomChips`: "Tất cả" + rooms theo `order` + chip `+` dashed; giữ lâu (500 ms) chip room → SH-5 `edit` (FR-F12; đổi tên/xóa room, xóa → devices `roomId=null`). Chip `+` → SH-5 `newRoom`.
- `DeviceGrid`: `layouts/{site}.filters[filter]` (D-02); device chưa có trong layout → thêm cuối theo `createdAt`. Tile 1×1 171×120 / 2×1 358×120, gap 16, 2 cột (desktop 4).
- `DeviceTile` nội dung theo Design Spec "Quy ước nội dung": hàng 1 icon + chấm online; hàng 2 giá trị `primaryProperty` format vi-VN (`0,38`) + đơn vị, không có sensor → "Bật"/"Tắt"; hàng 3 tên + room (chỉ khi filter=all); toggle góc dưới phải (≥ 44 pt) nếu có `toggleProperty`. 2×1: cột phải 2 sensor phụ (lấy 2 sensor numeric tiếp theo). Variants/states: on/off/pending/offline/arranging/highlight (viền accent fade 2 s sau khi thêm từ S-11).
- Toggle: `setValues(id, {[toggleProperty]: !current})` → `pending[key]` → clear khi `state` khớp → 3000 ms rollback + toast "Không nhận được phản hồi từ {tên}". Hub offline hoặc device offline → toggle disabled.
- Chế độ sắp xếp: giữ lâu tile → `ui.arranging=true`; `@dnd-kit` sortable; handle góc dưới phải đổi 1×1↔2×1; chips opacity .45 và không đổi filter; `SiteSwitcher` disabled; nút "Xong" thay +. Lưu `layouts` debounce 500 ms, `rev+1`.
- Empty states: chưa có device ("Chưa có thiết bị nào" + CTA "Thêm thiết bị đầu tiên"), room trống ("Chưa có thiết bị trong {room}" + "Gán thiết bị vào {room}"), loading skeleton 4 tile. Tab Automate chấm đỏ khi có rule `lastResult="broken"`; tab Me chấm khi hub offline.
- Bấm thân tile → `/device/$deviceId` (S-20).

### FR-F02 S-02 Automate (US-08/09/14/16)
- `SegmentedTabs` "Tap-to-run" · "Automation" (vuốt ngang đổi tab). Trạng thái sub-tab đang chọn được lưu giữ khi chuyển sang Rule Editor và quay lại. Nút + → SH-2 (Tạo scene / Tạo automation).
- Scene grid 2 cột `SceneCard`: chạm → `sendCommand({type:"scene.run"})` → trạng thái từ `runs` ("Đang chạy {done} / {total}…", vòng tiến độ) → `ok` tick 1 s / `partial|failed` badge "Lỗi"; giữ lâu → SH-6 (FR-F13: Sửa / Xóa). Dòng chú thích "Chạm để chạy · giữ lâu để sửa hoặc xóa".
- `RuleCard`: chạm → S-30 sửa; giữ lâu → SH-6 như SceneCard. Nội dung: tên, `summarizeTrigger()` 1 dòng, `Switch` (`enabled`, ghi Firestore `rev+1`), hàng dưới: badge `OK`/`Lỗi`/`Đang đồng bộ` + "Chạy lần cuối {HH:mm}" / "Đã lưu, hub đang nạp…" / "Thiết bị không còn: {tên}" / "Đã tắt · chạy lần cuối…". `syncing` = `appliedRev !== rev`. Broken → switch disabled.
- Trống: `SuggestionCard` ×3 sinh từ thiết bị hiện có (template trong `features/automate/suggestions.ts`: tắt hết ổ cắm; bật đèn sân; đi ngủ / tắt lúc 23:00; báo > 1500 W; mặt trời lặn) → mở S-30 với rule điền sẵn.

### FR-F03 S-03 Me (US-15/16) & S-40 Cài đặt (US-12)
- Thẻ tài khoản (avatar, tên, email, "tenant {name}"). Mục Hub: `HubRow` (chấm online/offline, "v{agentVersion} · {deviceCount} thiết bị · {site}") → `S03-ChiTietHub` (trạng thái online/offline, Thông tin: tên, site, số thiết bị, "Automation · scene"; Kết nối: địa chỉ LAN `hub.lanUrl` + "Mở"; Phiên bản: agent, Zigbee2MQTT; "Đổi tên"; "Gỡ hub" → dialog xác nhận có checkbox "Tôi hiểu..." → `DELETE /v1/hubs/{id}` → về S-03); "Thêm hub" → S-10. Chưa có hub → card hướng dẫn.
- Site & Room: danh sách site mở ra room với số thiết bị; kéo sắp `order`; chạm room → SH-5 `edit`; "Thêm site hoặc room" → SH-5 `pick` (Thêm room / Thêm site).
- Có device `status:"new"` → dòng `Badge` "Mới" + "1 thiết bị chưa đặt tên" trong nhóm Hub (prop `unnamed`) → S-11 bước 3.
- Lịch sử: 5 `EventRow` gần nhất từ Firestore `events` (`ts desc`, types `rule.fired|scene.run|rule.broken|notify`), "Xem tất cả (7 ngày)" → `S03-LichSu`: chip "Tất cả" / "Chỉ lỗi", nhóm theo ngày ("Hôm nay", "Hôm qua", "Thứ 4, 14/10"), mỗi dòng giờ + tên + loại (Automation / Scene · chạy tay / Thông báo đã gửi / Automation hỏng: …) + Badge OK/Lỗi; cuối "Hiện 7 ngày gần nhất"; trống → "Chưa có gì trong 7 ngày qua".
- S-40: Hiển thị (ngôn ngữ v1 chỉ "Tiếng Việt", đơn vị °C/°F, giao diện Sáng/Tối/Hệ thống → `members/{uid}.prefs` + local); Kết nối: "Chế độ LAN" hiện `hub.lanUrl` + nút "Mở" (`window.open(lanUrl, "_blank")`) — **không** có toggle tự động (D-17); Thông báo: "Sắp có" (Phase 2); Tài khoản: Đăng xuất; **ẩn** "Xóa tài khoản" (D-16); Về app: phiên bản (từ `__APP_VERSION__`), hub agent `v{agentVersion} · Zigbee2MQTT {z2mVersion}`.

### FR-F04 S-10 Thêm hub (US-02) — Stepper 3 bước
1. Cài agent: `SegmentedTabs` Windows/Linux; khối lệnh copy tự động (`navigator.clipboard`): Linux `curl -fsSL https://<url>/agent/install.sh | sudo bash -s -- --claim-code <code> --api-url <url>`, Windows `irm https://<url>/agent/install.ps1 | iex`; nút "Tôi đã cài", "Xem hướng dẫn chi tiết".
2. Nhập mã: `CodeInput` 8 ô, tự nhảy, paste cả chuỗi, chỉ nhận `[A-HJ-NP-Z2-9]`; nút "Quét QR trên trang setup" (`@zxing/browser`, parse `devicenet://claim?code=`); hướng dẫn truy cập trang setup tại `http://<ip>:8080/setup`; dòng "Mã hết hạn sau **15 phút**" (sửa wireframe 10 → 15). Nút "Kết nối" → `POST /v1/hubs/claim {code, siteId, name:"Hub {site}"}`.
   Lỗi: 400 → ô đỏ rung 300 ms, "Mã sai hoặc đã hết hạn.", nút "Lấy mã mới ở hub"; 409 → giải thích + lệnh `devicenet-agent reset`.
3. Kết nối: dòng trạng thái "Đang xác nhận mã" → "Đang chờ hub" → "Hub đã online" khi `onSnapshot hubs/{id}.online===true` **hoặc** MQTT `status.online===true` (cái nào tới trước); > 60 s → gợi ý kiểm tra mạng. Form tên hub + chọn site (có "Site mới") → "Hoàn tất" / lần đầu "Thêm thiết bị ngay" → S-11.

### FR-F05 S-11 Thêm thiết bị (US-03/07) — Stepper 3 bước
1. Chọn hub: v1 mỗi site đúng một hub (data-model: `hubId` = hub duy nhất của site) → bước này tự hoàn tất, Stepper hiện ✓, mở thẳng bước 2. Không cần artboard.
2. Tìm: `sendCommand({type:"pairing.start", seconds:120})` → `CountdownRing` từ `pairing.expiresAt` − (now + clockOffset); dòng "Hub {tên} · online · đang mở ghép nối"; hướng dẫn "Giữ nút trên thiết bị 5 giây đến khi đèn nháy."; `FoundDeviceCard` từ `devices` where `status=="new" && hubId` (model, hãng, "{n} thuộc tính · LQI {lqi}", badge "Mới", nút "Đặt tên"); "Đang tìm thêm…"; nút "Tiếp tục với {n} thiết bị". Hub offline → chặn bước 2, banner + "Đến mục Hub trong Me". Hết giờ không thấy → "Chưa thấy thiết bị nào" + mẹo reset + "Tìm lại".
   Rời màn → `pairing.stop`.
3. Đặt tên: mỗi card: ô tên (mặc định model), chip room (+ "Room mới"), icon (plug/toggle/bulb/fan/zap/thermometer…), radio "Thuộc tính chính trên tile" trong sensor numeric (hiện giá trị hiện tại) → "Lưu" / "Lưu tất cả" → update device `{name, roomId, icon, primaryProperty, status:"active", updatedAt}` + `sendCommand device.rename`. Xong → `/home` với tile highlight 2 s.

### FR-F06 S-20 Chi tiết thiết bị (US-13/14)
- Header back + tên + nút sửa → SH-3 (FR-F10). Đổi `label` property: **không làm ở v1** (contract giữ field `labels` cho bản sau).
- Hero: icon lớn, "Đang bật · 86 W" / "Đang tắt" / "Offline", dòng "{room} · online · cập nhật {x} trước" (`at[primary]`), toggle lớn (pending spinner).
- Nhóm Điều khiển: `PropertyControl` cho `category=control` && writable: binary→switch; numeric rw→slider+ô số; enum ≤4→segmented, >4→select. Dòng phụ "{key} · {access}".
- Nhóm Cảm biến: `PropertyRow` (label, giá trị+đơn vị, "cập nhật {x} trước" từ `at[key]`; stale > 10 phút chữ mờ); numeric → chạm mở `PropertyChart` 24 h (Recharts line, 6 mốc giờ) dữ liệu từ `HistorySource` (LAN: `/api/history`; cloud: cmd `history.get`).
- Nhóm Cấu hình: `category=config`. Nhóm Kỹ thuật: Driver "{driver} · {model}", Địa chỉ `externalId`, Hãng · model, Firmware, "LQI {lqi} / 255", Hub.
- Offline: hero xám, banner "Thiết bị offline · lần cuối {HH:mm}", card "Thiết bị không phản hồi" + hướng dẫn, control disabled ("· disabled"), nút "Tìm lại thiết bị" → `device.ping`.
- "Xóa thiết bị" → SH-4.

### FR-F07 SH-4 Xác nhận xóa (US-14) — 2 bước
- Bước 1: "Xóa "{tên}"?", "Hub sẽ gỡ thiết bị khỏi mạng Zigbee.", danh sách "{n} automation đang dùng thiết bị này sẽ bị đánh dấu lỗi:" từ `referencedIds()` trên rules+scenes, checkbox "Tôi hiểu, lịch sử và biểu đồ của thiết bị sẽ mất." → "Xóa".
- Bước 2: "Xóa vĩnh viễn?" "Không hoàn tác được…" → "Giữ lại" / "Xóa thiết bị" → `sendCommand({type:"device.remove", deviceId, force: !online})` → chờ ack → về Home; ack lỗi → toast.

### FR-F08 S-30 Soạn rule / scene (US-08/09/10)
- Header Hủy · tiêu đề ("Automation mới" / tên) · Lưu (disabled đến khi Zod `Rule`/`Scene` parse OK). Ô tên + chọn icon.
- Tự động khắc phục siteId (Auto-heal): khi `uiStore.siteId` bị cũ, trống hoặc trỏ tới site không tồn tại, tự động chuyển về site hợp lệ đầu tiên trong danh sách `configStore.sites`.
- `RuleBlock` Khi (1 trigger) / Và nếu (0..n, toggle "Tất cả (AND)" · "Bất kỳ (OR)") / Thì (1..n, kéo sắp `@dnd-kit`). Scene: ẩn Khi và Và nếu.
- Xóa điều kiện / hành động: cung cấp nút xóa (`onDelete`) trong `ConditionSheet` ("Xóa điều kiện") và `ActionSheet` ("Xóa hành động") để người dùng gỡ bỏ từng mục đã thêm.
- Lọc phép so sánh (Operator filtering): chỉ hiển thị các phép so sánh phù hợp với kiểu dữ liệu thuộc tính:
  - Thuộc tính `binary`: chỉ hiển thị "Bằng" (`eq`), "Khác" (`neq`) với giá trị Bật/Tắt.
  - Thuộc tính `numeric`: hiển thị đầy đủ 7 phép so sánh ("nhỏ hơn", "≤", "bằng", "≠", "≥", "lớn hơn", "trong khoảng").
  - Thuộc tính `enum`: hiển thị `eq`, `neq` kèm danh sách giá trị enum khả dụng.
- Sheet chọn trigger: Thiết bị / Thời gian / Mặt trời. Placeholder hiển thị "Không có thiết bị khả dụng" kèm chú thích khi không tìm thấy thiết bị nào trong site hiện tại. Thời gian: giờ + ngày trong tuần. Mặt trời: mọc/lặn ± phút.
- Sheet thêm action: Đặt thiết bị / Chờ / Chạy scene / Thông báo.
- Dưới: `Switch` "Bật automation" ("Chạy trên hub, kể cả khi mất internet"; chưa lưu → "Bật được sau khi lưu"); nút "Chạy thử (chỉ phần Thì)" → `actions.test` → hiện `runs` inline.
- Lưu: Firestore `rev+1`, `hubId` = hub của site (v1 duy nhất) → `StatusBanner reconnecting` "Đã lưu, hub đang nạp… (tối đa 5 giây)" tới khi `appliedRev===rev` → về S-02; quá 5 s → về S-02 với badge "Đang đồng bộ" (không lỗi).
- Invalid: khối thiếu viền `warning` + dòng lỗi từ Zod (map message tiếng Việt trong `i18n/vi.ts`).

### FR-F09 SH-1 Chọn site, SH-2 Menu +
- SH-1: danh sách site ("{n} thiết bị · {hub status}" / "Chưa có hub"), "Thêm site" → SH-5 `newSite`. 1 site vẫn mở sheet.
- SH-2 (Home): Thêm thiết bị ("Hub tìm thiết bị Zigbee trong 120 giây"), Thêm room ("Trong site {tên}" → SH-5 `newRoom`), Thêm hub ("Cài agent · nhập mã · kết nối"), Sắp xếp tile ("Hoặc giữ lâu một tile"). (Automate): Tạo scene, Tạo automation.

### FR-F10 SH-3 Sửa thiết bị nhanh (US-07) — artboard `SH3-SuaNhanh`
- Mở từ nút sửa ở header S-20 (nút chuyển màu accent, `aria-expanded=true`); S-20 vẫn hiện phía sau dưới scrim; `Sheet` tiêu đề "Sửa thiết bị".
- Nội dung theo thứ tự: `Input` "Tên" (mặc định tên hiện tại) → nhóm "Room": `Chip` các room của site (chọn 1) + chip add "Room mới" → nhóm "Icon": radiogroup 8 nút 44×44 xuống dòng (Ổ cắm, Công tắc, Đèn, Quạt, Nhiệt độ, Điện năng, Chuyển động, Cửa; đang chọn = viền 2 px accent + nền `on-tint`) → "Thuộc tính chính trên tile": radio list các property sensor numeric, mỗi hàng label + giá trị hiện tại (`0,38 A`, tabular) → hai nút "Hủy" (secondary) · "Lưu" (primary) chia đôi chiều ngang.
- Lưu: update device `{name, roomId, icon, primaryProperty, updatedAt}` + `sendCommand device.rename` nếu đổi tên (như S-11 bước 3) → đóng sheet; lỗi → toast. Device offline vẫn sửa được (chỉ là cấu hình Firestore).
- Map icon → lucide / giá trị `device.icon`: Ổ cắm=plug, Công tắc=toggle-left, Đèn=lightbulb, Quạt=fan, Nhiệt độ=thermometer, Điện năng=zap, Chuyển động=radar, Cửa=door-open (`design/dn-icons.js`). `router` chỉ dùng cho hub, không có trong picker.

### FR-F11 Desktop 1280 (US-04/06/09) — artboard `D-Home`, `D-RuleEditor`
- Breakpoint ≥ 900 px. Khung chung thay tab bar: **sidebar** trái 240 px (`surface`, viền phải 1 px): logo DeviceNet; `SiteSwitcher` dạng nút full-width nền `surface-2`; nav dọc Home / Automate / Me (mục hiện tại nền `on-tint` chữ accent, `aria-current="page"`; chấm đỏ ở Automate khi có rule broken); thẻ hub cuối sidebar (chấm online + "Hub {tên}" + "online · v{agentVersion} · {n} thiết bị"; không ghi trạng thái LAN, theo D-17).
- **D-Home**: main padding 24/32; hàng tiêu đề = tên site (24/30) + nút "Sắp xếp" (secondary, thay cho giữ lâu) + "+ Thêm" (primary, mở SH-2); `RoomChips` xuống dòng khi tràn; lưới **4 cột** gap 16, max-width 1000, tile 2×1 = span 2 cột; ô cuối viền dashed "Thêm thiết bị" → S-11. Dưới 900 px: lưới về 2 cột, sidebar xếp lên trên.
- **D-RuleEditor** (cùng hành vi FR-F08, khác bố cục): header nút back → S-02, tên rule, `Badge` "Đang bật"; bên phải "Hủy" (ghost), "Chạy thử" (secondary, = `actions.test`), "Lưu" (primary). Cột trái (480–640 px): nút chọn icon + `Input` "Tên"; `Card` "Khi" / "Và nếu" (có `SegmentedTabs` "Tất cả (AND)"·"Bất kỳ (OR)") / "Thì" (hàng đánh số 1..n), mỗi card có `IconButton` "Thêm". Cột phải (360 px): card "Xem trước" (một câu tiếng Việt tóm tắt cả rule Khi / và nếu / thì, ghép từ `summarizeTrigger`/`summarizeAction`) + `Switch` "Bật automation"; card "Trạng thái" ("Hub": "Đã nạp · rev {rev}" hoặc "Đang đồng bộ"; "Chạy lần cuối"; "Tổng 7 ngày": "{n} lần · {m} lỗi" từ `events`); card "Lịch sử" (3 lần chạy gần nhất + `Badge`); nút danger "Xóa automation" → dialog xác nhận của SH-6 `confirm` (giữa màn hình).
- **Màn khác trên desktop** (danh sách S-02, S-03 và trang con, S-20, S-10, S-11, S-40, S-30 mobile) theo quy ước của `D-ChiTiet`: sidebar như trên; nội dung mobile của màn đó đặt trong cột `max-width 640`, padding 24/32; header mobile thành hàng tiêu đề 24/30 (nút back nếu có + tiêu đề + nút hành động dạng `Button` secondary); bottom sheet (SH-1..SH-6, sheet chọn trigger) thành **dialog giữa màn hình** rộng 480, bo 20, có scrim.

### FR-F12 SH-5 Room và site (US-07) — artboard `SH5-SiteRoom`
- `edit` (giữ lâu chip room / chạm room ở S-03): Sheet "Sửa room": `Input` "Tên room" (hint "{n} thiết bị · site {site}") → "Hủy" · "Lưu"; ngăn cách; `Button` danger "Xóa room" + chú thích "Thiết bị trong room chuyển về "Chưa gán room", không bị gỡ khỏi hub."
- `confirm`: dialog "Xóa room "{tên}"?" · "{n} thiết bị sẽ chuyển về "Chưa gán room". Automation, scene và lịch sử không bị ảnh hưởng." · "Giữ lại" / "Xóa room" → batch: devices `roomId=null`, xóa room, cập nhật `layouts` (bỏ filter của room).
- `newRoom`: Sheet "Thêm room", `Input` "Tên room" (placeholder "Ví dụ: Phòng làm việc", hint "Trong site {site}") → "Hủy" · "Thêm room" (disabled khi rỗng).
- `newSite`: Sheet "Thêm site", `Input` "Tên site" (hint "Múi giờ Asia/Ho_Chi_Minh, lấy theo máy này" = `Intl.DateTimeFormat().resolvedOptions().timeZone`), chú thích "Mỗi site cần một hub riêng…" → "Hủy" · "Thêm site".
- `pick` (Me › "Thêm site hoặc room"): Sheet "Thêm" 2 dòng: "Thêm room" ("Trong site {site}") → `newRoom`; "Thêm site" ("Mỗi site cần một hub riêng") → `newSite`.

### FR-F13 SH-6 Sửa/xóa scene, automation (US-08/09) — artboard `SH6-XoaAutomation`
- `menu` (giữ lâu SceneCard/RuleCard; card đang giữ viền accent 2 px): Sheet tiêu đề = tên; dòng "Sửa" ("Đổi tên, icon, hành động") → S-30; dòng "Xóa" màu `danger` → `confirm`.
- `confirm`: dialog "Xóa "{tên}"?"; scene: "Hub sẽ gỡ scene này." + nếu có rule dùng `scene.run` của nó: "{n} automation đang chạy scene này sẽ bị đánh dấu lỗi:" + danh sách `Badge` "Sẽ lỗi"; rule: "Hub sẽ gỡ automation này."; chú thích "Lịch sử chạy vẫn giữ trong mục Lịch sử." → "Giữ lại" / "Xóa" (danger) → xóa doc Firestore (hub nhận qua listener).

### FR-F14 Toast (US-05/15) — artboard `S01-Toast`
- Một toast tại một thời điểm, nằm trên tab bar (cách đáy 99 px trên mobile; desktop: góc dưới giữa vùng main), nền `text`, chữ `bg`, bo 12, cao ≥ 48, `role="status"`; tự ẩn sau 4 s (toast có nút: tới khi bấm hoặc 8 s).
- `timeout` / `error`: icon alert màu `danger` + câu (vd. "Không nhận được phản hồi từ {tên}", "Không xóa được thiết bị. Thử lại sau."). `update`: icon refresh + "Có bản mới" + nút "Tải lại".

## 5. PWA & offline
- `vite-plugin-pwa` `registerType: autoUpdate`, manifest (name "DeviceNet", theme `#F6F7F9`/`#0F1115`, icons 192/512 maskable), precache asset; `index.html` network-first; toast "Có bản mới" + nút "Tải lại" (FR-F14).
- Firestore `persistentLocalCache({tabManager: persistentMultipleTabManager()})`; Home hiện dữ liệu cache (tile mờ) khi không mạng.
- LAN build: không import `firebase/*` (tree-shaken bằng `import.meta.env.VITE_MODE`); đọc `GET /api/config` poll 30 s + ETag; MQTT `ws://{location.host}:9001` (host của trang LAN); header "Đang dùng chế độ LAN"; ẩn S-10, S-11, Me > tài khoản; cho phép S-30 chỉ đọc (sửa rule cần cloud ở v1 → nút Lưu disabled với tooltip).

## 6. Design tokens & component
- Dùng `design/ds/devicenet/tokens.json` → theme tokens Tailwind 4 (`@theme`): màu `bg, surface, surface-2, text, text-muted, border, accent, on-accent, on-tint, success(-tint), warning(-tint), danger(-tint), lan(-tint)` (giá trị sáng/tối như `design/dn.css`), spacing `space-1..12`, radius, size (`touch-min 44`, `header-h 56`, `banner-h 32`, tile `171/358 × 120`, icon `24/16`); light/dark qua `class="dark"`.
- Component: dựng lại đúng giao diện các component của design system `DeviceNet.*` (Button, Chip, Switch, Slider, SegmentedTabs, Card, Sheet, Banner, Badge, Input, Stepper, DeviceTile; tham chiếu props/variant ở `design/ds/devicenet/components/bundle.{js,css}`). shadcn/ui chỉ làm primitive hành vi/a11y. Khung dùng chung (header 56, tab bar, row, card, kv) theo `design/dn.css`.
- Inter 400/500/600 (self-host), `font-variant-numeric: tabular-nums` cho số; bo góc tile 16 / chip 999 / nút 12 / sheet 20; viền 1 px thay bóng; chuyển động theo Design Spec, tôn trọng `prefers-reduced-motion`.
- Icons lucide-react stroke 1.75; bộ icon thiết bị: plug, toggle-left, lightbulb, fan, thermometer, radar, door-open, zap, router.
- A11y: `<button>`/`<a>` thật, `aria-label` icon-only, tương phản ≥ 4.5:1, vùng chạm ≥ 44.

## 7. Non-functional
- Bundle đầu < 250 KB gzip (lazy: Recharts, RuleEditor, zxing); Home 50 tile < 1 s; kéo thả 60 fps.
- Lighthouse PWA pass; iOS standalone đăng nhập bằng redirect.
- Test: Vitest + Testing Library; `transport` test với mock MQTT (`aedes` in-memory) cho optimistic/rollback/dedupe `seq`; RuleEditor validate; Playwright smoke: login mock → claim mock → pairing mock → toggle.

## 8. Bảng chuỗi UI (nguyên văn wireframe, đưa vào `i18n/vi.ts`)
Banner: "Hub Nhà đang offline · lần cuối 12:40" · "Đang dùng chế độ LAN · 192.168.1.20" · "Đang kết nối lại…" · "Đã lưu, hub đang nạp… (tối đa 5 giây)".
Home: "Tất cả" · "Chưa có thiết bị nào" · "Giữ nút trên thiết bị Zigbee 5 giây đến khi đèn nháy, rồi bấm nút dưới để hub tìm nó." · "Thêm thiết bị đầu tiên" · "Chưa có thiết bị trong Bếp" · "Gán thiết bị có sẵn vào room này, hoặc thêm thiết bị mới." · "Gán thiết bị vào Bếp" · "Kéo để đổi chỗ · kéo góc dưới phải để đổi cỡ 1×1 ↔ 2×1" · "Xong".
Automate: "Tap-to-run" · "Automation" · "Chạm để chạy · giữ lâu để sửa hoặc xóa" · "Đang chạy 2 / 4…" · "3 hành động" · "Chạy lần cuối 07:02" · "Đang đồng bộ" · "Thiết bị không còn: Đèn sân" · "Đã tắt · chạy lần cuối 18:05 hôm qua" · "Chưa có scene nào" · "Scene gom nhiều hành động vào một nút bấm. Chạm card gợi ý để tạo ngay." · "Chưa có automation nào" · "Automation tự chạy khi điều kiện xảy ra, ngay trên hub kể cả khi mất internet." · "Gợi ý từ thiết bị của bạn" · "Tạo scene" · "Tạo automation".
S-10: "Thêm hub" · "Cài agent" / "Nhập mã" / "Kết nối" · "Cài agent lên máy có dongle Zigbee" · "Agent chạy Zigbee2MQTT và nối hub của bạn với DeviceNet." · "Chạy trong PowerShell với quyền Administrator. Cắm dongle Sonoff ZBDongle-E trước khi chạy." · "Sau khi cài xong" · "Tôi đã cài" · "Xem hướng dẫn chi tiết" · "Nhập mã của hub" · "Mã hiện ở trang http://<ip>:8080/setup hoặc trong log của agent." · "Quét QR trên trang setup" · "Mã hết hạn sau 15 phút và chỉ dùng được một lần. Nếu không thấy mã, chạy lại agent để lấy mã mới." · "Mã sai hoặc đã hết hạn." · "Lấy mã mới ở hub" · "Tôi đã có mã mới" · "Thử lại" · "Đang xác nhận mã" · "Đang chờ hub" · "Hub đã online" · "Thêm thiết bị ngay" · "Hoàn tất".
S-11: "Thêm thiết bị" · "Chọn hub" / "Tìm thiết bị" / "Đặt tên" · "Hủy" · "đang mở ghép nối" · "Giữ nút trên thiết bị 5 giây đến khi đèn nháy." · "Đã tìm thấy 1 thiết bị" · "Mới" · "Đặt tên" · "Đang tìm thêm…" · "Tiếp tục với 1 thiết bị" · "Chưa thấy thiết bị nào" · "Hub đã mở ghép nối 120 giây mà không có thiết bị nào xin vào mạng." · "Mẹo reset thiết bị" · "Tìm lại" · "Hub đang offline" · "Cần hub online để mở ghép nối. Kiểm tra máy chạy agent và mạng, rồi quay lại." · "Đến mục Hub trong Me" · "Thuộc tính chính trên tile" · "Lưu tất cả" · "Lưu" · "Room mới".
S-20: "Đang bật · 86 W" · "cập nhật 12 giây trước" · "Điều khiển" · "Cảm biến" · "Cấu hình" · "Kỹ thuật" · "Xóa thiết bị" · "Thiết bị offline · lần cuối 12:40" · "Thiết bị không phản hồi" · "Tìm lại thiết bị".
SH-3: "Sửa thiết bị" · "Tên" · "Room" · "Room mới" · "Icon" · "Ổ cắm" / "Công tắc" / "Đèn" / "Quạt" / "Nhiệt độ" / "Điện năng" / "Chuyển động" / "Cửa" · "Thuộc tính chính trên tile" · "Hủy" · "Lưu".
SH-5: "Sửa room" · "Tên room" · "2 thiết bị · site Nhà" · "Xóa room" · "Thiết bị trong room chuyển về "Chưa gán room", không bị gỡ khỏi hub." · "Xóa room "Bếp"?" · "2 thiết bị sẽ chuyển về "Chưa gán room". Automation, scene và lịch sử không bị ảnh hưởng." · "Thêm room" · "Ví dụ: Phòng làm việc" · "Trong site Nhà" · "Thêm site" · "Tên site" · "Ví dụ: Nhà quê" · "Múi giờ Asia/Ho_Chi_Minh, lấy theo máy này" · "Mỗi site cần một hub riêng. Sau khi tạo, thêm hub cho site này ở mục Hub trong Me." · "Thêm" · "Mỗi site cần một hub riêng".
SH-6: "Sửa" · "Đổi tên, icon, hành động" · "Xóa" · "Xóa "Đi ngủ"?" · "Hub sẽ gỡ scene này. 1 automation đang chạy scene này sẽ bị đánh dấu lỗi:" · "Sẽ lỗi" · "Lịch sử chạy vẫn giữ trong mục Lịch sử." · "Giữ lại".
Toast: "Không nhận được phản hồi từ Ổ cắm quạt" · "Không xóa được thiết bị. Thử lại sau." · "Có bản mới" · "Tải lại".
Desktop: "Sắp xếp" · "+ Thêm" · "Thêm thiết bị" · "Đang bật" · "Chạy thử" · "Xem trước" · "Bật automation" · "Trạng thái" · "Đã nạp · rev 14" · "Chạy lần cuối" · "Tổng 7 ngày" · "5 lần · 0 lỗi" · "Lịch sử" · "Xóa automation".
SH-4: "Xóa "{tên}"?" · "Hub sẽ gỡ thiết bị khỏi mạng Zigbee." · "automation đang dùng thiết bị này sẽ bị đánh dấu lỗi:" · "Sẽ lỗi" · "Tôi hiểu, lịch sử và biểu đồ của thiết bị sẽ mất." · "Xóa vĩnh viễn?" · "Không hoàn tác được. Muốn dùng lại, bạn phải ghép nối thiết bị từ đầu." · "Giữ lại".
S-30: "Khi" · "Và nếu" · "Thì" · "Tất cả (AND)" · "Bất kỳ (OR)" · "Không bắt buộc · 0 điều kiện" · "+ Thêm điều kiện" · "Chưa có hành động nào" · "Bật automation" · "Chạy trên hub, kể cả khi mất internet" · "Bật được sau khi lưu" · "Chạy thử (chỉ phần Thì)" · "Chọn 1 trigger" · "Thiết bị" / "Thời gian" / "Mặt trời" · "Liên tục trong" · "Xóa điều kiện" · "Xóa hành động" · "Không có thiết bị khả dụng trong site này" · "Sửa điều kiện" · "Sửa hành động".
S-40/Me: "Cài đặt" · "Hiển thị" · "Kết nối" · "Chế độ LAN" · "Điều khiển trực tiếp qua hub khi cùng mạng Wi‑Fi, không cần internet" · "Mở" · "Thông báo" · "Sắp có" · "Tài khoản" · "Đăng xuất" · "Về app" · "Hub" · "Thêm hub" · "Chưa có hub" · "Cài agent lên máy có dongle Zigbee, nhập mã 8 ký tự là xong trong 3 phút." · "Site & Room" · "Thêm site hoặc room" · "Lịch sử" · "Xem tất cả (7 ngày)" · "1 thiết bị chưa đặt tên" · "Mới".
Chi tiết hub: "Hub Nhà" · "Online" / "Offline" · "cập nhật 8 giây trước" · "Thông tin" · "Tên" · "Site" · "Thiết bị" · "Automation · scene" · "Kết nối" · "Địa chỉ LAN" · "http://192.168.1.20:8080 · địa chỉ lần cuối hub báo" · "Mở" · "Phiên bản" · "Hub agent" · "Zigbee2MQTT" · "Đổi tên" · "Gỡ hub" · "Gỡ "Hub Nhà"?" · "6 thiết bị của hub này sẽ bị gỡ khỏi tài khoản và 4 automation sẽ bị đánh dấu lỗi. Agent trên máy ngừng kết nối; muốn dùng lại phải nhập mã mới." · "Tôi hiểu, thiết bị phải ghép nối lại từ đầu.".
Lịch sử: "Lịch sử" · "Tất cả" · "Chỉ lỗi" · "Hôm nay" · "Hôm qua" · "Thứ 4, 14/10" · "Automation" · "Scene · chạy tay" · "Thông báo đã gửi" · "Hiện 7 ngày gần nhất" · "Chưa có gì trong 7 ngày qua" · "Lần chạy của scene, automation và thông báo sẽ hiện ở đây.".

## 9. Edge cases phải có test
- Mở S-11 khi pairing đã chạy từ thiết bị khác → đếm ngược đúng từ retained `pairing`.
- Nhận `state` với `seq` cũ hơn → bỏ qua; hub reboot `seq` reset → chấp nhận theo `ts`.
- Toggle 3 tile liên tiếp nhanh → 3 pending độc lập; rollback đúng tile không khớp.
- Token hết hạn trong lúc MQTT đang nối → không ngắt; reconnect dùng token mới.
- Firestore có device `status:"new"` nhưng không ở màn S-11 → Home **không** hiện tile (chỉ hiện `active`); S-03 có dòng "1 thiết bị chưa đặt tên" (`S03-Me` prop `unnamed`) → mở S-11 bước 3.
- Rule Editor: `changed` không cho nhập giá trị/`for`; `for` nhập 3 phút → lưu 180.
- LAN build: `/api/config` 30 s; Lưu rule disabled; toggle hoạt động.

## 10. Open questions
Đã đóng (2026-10-17, theo Design bản `1792252649-5fd0`):
- ~~Desktop 1280 chưa có wireframe~~ → có `D-Home`, `D-RuleEditor` (FR-F11).
- ~~SH-3 chưa có wireframe~~ → có `SH3-SuaNhanh` (FR-F10).
- Các mục sửa wireframe ghi trong README đã có trong Design: S-10 "15 phút"; S-30 đủ 7 phép so sánh (nhỏ hơn, ≤, bằng, ≠, ≥, lớn hơn, đổi sang); S-40 không còn toggle LAN tự động, không có "Xóa tài khoản"; gap lưới 16; SH-2 có "Sắp xếp tile"; Stepper S-11 có bước "Chọn hub".

Đã chốt (2026-10-17, Design bản `1792254951-200a`):
- OQ-3 Sửa/xóa room → SH-5 (FR-F12), kèm thêm room/site và menu "Thêm site hoặc room".
- OQ-4 Đổi `label` property → không làm ở v1; contract giữ `labels`.
- OQ-5 Icon picker → 8 icon (thêm Chuyển động=radar, Cửa=door-open); `router` chỉ cho hub.
- OQ-6 Thẻ hub sidebar desktop → bỏ "· LAN" (đúng D-17); bản LAN đã có banner riêng.
- OQ-7 Xóa scene/automation → SH-6 menu + xác nhận (FR-F13), desktop dùng cùng dialog.
- OQ-8 Desktop màn khác → quy ước `D-ChiTiet` (cột 640 + sheet → dialog 480).
- OQ-9 → `S03-ChiTietHub`, `S03-LichSu`, prop `unnamed` trên `S03-Me`, `S01-Toast` (FR-F14); S-11 bước 1 tự hoàn tất (v1 một hub mỗi site).

Còn mở: không. Mục mới phát sinh khi implement → `specs/002-frontend-pwa/open-questions.md`.
