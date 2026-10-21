# Runbook M-Local — chạy DeviceNet trên máy Windows (dongle thật)

Mục tiêu: sáng mai bật toàn bộ hệ thống trên 1 máy, đăng nhập web, liên kết hub, ghép ổ cắm TS011F và bật/tắt nó từ màn Home.

Mọi lệnh chạy ở thư mục gốc repo (`<thư mục repo>`), PowerShell hoặc Git Bash.

## 0. Bảng địa chỉ

| Thành phần | Địa chỉ |
|---|---|
| Web (cloud mode) | http://localhost:5173 |
| Emulator UI (Auth + Firestore) | http://127.0.0.1:4000 |
| api | http://127.0.0.1:3000 (`/healthz`) |
| Dev cloud broker (thay EMQX) | tcp 1884, ws `ws://localhost:8084/mqtt` |
| Hub LAN (trang + API) | http://127.0.0.1:8080 — từ máy khác trong LAN: `http://<ip-máy>:8080` |
| Mã claim của hub | http://127.0.0.1:8080/setup |
| Mosquitto của hub | tcp 1883 (user `hub`), ws 9001 (LAN, không auth) |

## 1. Chuẩn bị (một lần)

1. **Node 22+** và **pnpm 10** (`corepack enable` hoặc `npm i -g pnpm`).
2. **JDK 21** trong PATH (Firebase emulators cần Java): `java -version` phải in `21…`.
3. **Cài dependency + build shared:**
   ```powershell
   pnpm install
   pnpm --filter @devicenet/shared build
   ```
4. **Tải Mosquitto + Zigbee2MQTT** về `.tools\` (đã khóa phiên bản trong `installers/versions.json`):
   ```powershell
   node scripts/fetch-tools.mjs      # = pnpm tools:fetch
   pnpm tools:check                  # phải ra "all tools present."
   ```
   Muốn dùng `.tools` ở chỗ khác: đặt biến `DN_TOOLS_DIR` (mặc định `<repo>\.tools`).
5. **Cắm Sonoff ZBDongle-E** rồi kiểm tra cổng COM:
   ```powershell
   powershell -ExecutionPolicy Bypass -File scripts/find-zigbee-port.ps1   # in ra ví dụ COM5
   ```
   Hub tự dò cổng theo VID:PID `10C4:EA60` / `1A86:55D4` (`serialPort: auto`). Nếu dò sai, ghi cố định trong
   `.data\hub\config.yaml`:
   ```yaml
   serialPort: COM5
   ```
6. **(Tùy chọn) build trang LAN** để `http://<ip>:8080` hiển thị app (không build thì trang báo chưa có bản LAN):
   ```powershell
   pnpm --filter web build:lan       # ra apps/web/dist-lan
   ```

## 2. Chạy

```powershell
pnpm dev:real
```

Một tiến trình Node (`tools/dev/run.mjs`) bật lần lượt, chờ từng cổng sẵn sàng, log có tiền tố `[emu] [api] [broker] [hub] [web]`:

1. Firebase emulators (Auth 9099, Firestore 8085, UI 4000, project `demo-devicenet`, rules `infra/firestore.rules`)
2. api :3000
3. dev-cloud-broker tcp 1884 / ws 8084 (chuyển `status` của hub sang webhook api, token `dev-token`)
4. hub-agent: Mosquitto → Zigbee2MQTT (chờ `bridge/state online` tối đa 60 s) → LAN :8080 → xin mã claim
5. web dev :5173

Khi thấy `[dev] all up. Ctrl+C stops everything.` là xong. **Ctrl+C** dừng tất cả (cây tiến trình bị `taskkill /T` nếu còn sót).

Không có dongle / chỉ muốn thử giao diện: `pnpm dev` (Z2M giả lập, ghép thiết bị sẽ tự "tìm thấy" 1 ổ cắm TS011F sau ~1,5 s).
Dữ liệu hub: `.data\hub\` (dev:real) và `.data\hub-mock\` (dev) — xóa thư mục đó = hub mới tinh.

## 3. Các bước dùng thử

1. Mở http://localhost:5173 → **Đăng nhập Google** → cửa sổ emulator hiện ra → **Add new account** → điền tên/email bất kỳ → đăng nhập. Web tự gọi `bootstrap` (tạo tenant + nhà "Nhà").
2. Màn **S-10 Thêm hub**: lấy mã 8 ký tự ở http://127.0.0.1:8080/setup (hoặc trong log `[hub] … CLAIM CODE: XXXXXXXX (hết hạn HH:mm)`) → nhập → Kết nối.
   Mã sống 15 phút; hết hạn hub tự xin mã mới (tải lại `/setup`).
3. Vài giây sau hub **online** (log `[hub] hub claimed` → `Firestore signed in` → `mqtt connected` link cloud). Kiểm tra: http://127.0.0.1:8080/api/health → `claimed:true, mqttCloud:true, firestore:true, z2m:"online"`.
4. Màn **S-11 Ghép thiết bị** → bấm Ghép (mở permit-join 120 s) → **giữ nút trên ổ cắm TS011F ~5 s** đến khi đèn nháy nhanh → chờ phỏng vấn xong (10–30 s) → thiết bị hiện ra → **đặt tên** + chọn phòng.
5. Về **Home** → bấm tile ổ cắm để bật/tắt; trạng thái đổi sau khi ổ cắm báo lại (≤ 2 s).
6. Trang LAN: từ điện thoại cùng mạng mở `http://<ip-máy>:8080` (ip in trong log `lanUrl`), bật/tắt qua ws 9001.
7. Thử mất kết nối: dừng hub (Ctrl+C) → Emulator UI `tenants/…/hubs/…` có `online:false` (LWT). Chạy lại → online lại.

## 4. Kiểm tra nhanh tự động

```powershell
pnpm smoke
```
Tự bật api/broker/hub giả lập trên cổng riêng (3100/1894/8180 — chạy song song với `pnpm dev` được), dùng emulators đang chạy nếu có, rồi: tạo user → bootstrap → claim → hub online → webhook ghi `hubs.online=true` → ghép (mock) → device có trong Firestore → bật/tắt qua cloud và LAN → kill hub → `online=false`. In `SMOKE PASS` và tự dọn mọi tiến trình. Ngân sách 30 s (không tính lúc JVM emulator khởi động nguội). `pnpm smoke --full` thêm bước khởi động lại hub (vào lại trạng thái đã claim, không cần mã mới); `--verbose` in toàn bộ log.

## 5. Sự cố thường gặp

| Triệu chứng | Nguyên nhân / cách xử lý |
|---|---|
| Emulator/api treo, lỗi `ECONNRESET`, gRPC `14 UNAVAILABLE` | **Proxy công ty**. `run.mjs` đã xóa `HTTP(S)_PROXY` cho api/broker/hub/web và đặt `NO_PROXY=127.0.0.1,localhost`; Firebase CLI giữ proxy (để tải Emulator UI lần đầu) nhưng bỏ qua localhost. Nếu tự chạy lệnh tay: `$env:NO_PROXY='127.0.0.1,localhost'`. Dùng `node_modules\.bin\firebase`, không dùng `pnpm test:emu` khi đang có proxy. |
| `Failed to make request to https://storage.googleapis.com/…ui-v….zip` | Lần đầu emulator tải Emulator UI qua internet → cần proxy còn hoạt động. Chạy lại khi có mạng; các lần sau đã cache. |
| `/api/health` → `z2m:"offline"`, `lastError: Không tìm thấy USB Zigbee` | Dongle chưa cắm / driver CP210x chưa cài / cổng khác VID:PID. Chạy `scripts/find-zigbee-port.ps1`; đặt `serialPort: COMx` trong `.data\hub\config.yaml`; khởi động lại. |
| `Zigbee2MQTT không online sau 60 s (kiểm tra USB Zigbee / cổng COMx)` | Cổng COM đang bị chương trình khác giữ (Z2M cũ, ZHA, serial monitor), sai adapter, hoặc dongle cần rút ra cắm lại. Hub vẫn chạy (LAN, claim) và Z2M được watchdog khởi động lại. Xem log `[hub] … zigbee2mqtt`. |
| `Mosquitto not found … using the embedded broker` | Chưa `pnpm tools:fetch` hoặc `DN_TOOLS_DIR` sai. Kiểm tra `pnpm tools:check`. |
| `:8080 already in use — reusing` / cổng bị chiếm | Một hub/dev cũ còn chạy. Tìm: `netstat -ano | findstr :8080` → `taskkill /PID <pid> /T /F`. Tiến trình con cũ của hub (Mosquitto/Z2M) tự bị kill khi hub khởi động lại (`.data\hub\run\*.pid`). |
| Điện thoại không mở được `http://<ip>:8080` / ws 9001 | **Windows Firewall**: cho phép Node.js (và `mosquitto.exe`) trên mạng Private khi được hỏi, hoặc: `New-NetFirewallRule -DisplayName DeviceNet -Direction Inbound -Protocol TCP -LocalPort 8080,9001 -Action Allow -Profile Private`. Mạng Wi-Fi phải là Private. |
| Ghép không thấy thiết bị | Giữ nút lâu hơn (đèn phải nháy nhanh), để ổ cắm gần dongle, bấm Ghép lại (cửa sổ 120 s). Xem log `[hub]` có `device_interview`. |
| Login Google không hiện cửa sổ emulator | Emulator Auth chưa chạy (xem `[emu]`), hoặc mở web bằng `127.0.0.1` thay vì `localhost` — dùng đúng http://localhost:5173. |
| Muốn liên kết lại hub từ đầu | Dừng dev, chạy `pnpm --filter @devicenet/hub-agent exec tsx src/main.ts reset --data-dir ..\..\.data\hub` (xóa credentials + hub.key, giữ thiết bị Zigbee), hoặc xóa cả `.data\hub\`. |
| Log có `ExperimentalWarning: SQLite` | better-sqlite3 chưa build native (pnpm chặn build script) → hub dùng `node:sqlite` dự phòng, chạy bình thường. Muốn bỏ: `pnpm approve-builds` rồi `pnpm rebuild better-sqlite3`. |
