# Orchestration progress (đọc file này đầu tiên khi resume)

Quy ước: [x] xong + commit · [~] đang làm · [ ] chưa. Ghi hash commit cuối mỗi mốc.
Model: Opus = khó (engine, bridge/seq, claim crypto, FE transport) · Sonnet = mặc định · Haiku = cơ học.
Quyết định của anh:
- 2026-10-18: claim đầy đủ trên Firebase emulator `demo-devicenet`; ZBDongle-E (Z2M `ember`) + TS011F; tự tải Mosquitto/Z2M vào `.tools/`; mâu thuẫn → open-questions.md + chọn tạm `TODO-OQ`, không đổi contract.
- 2026-10-19: (1) Chấp thuận `node:sqlite` làm runtime mặc định/fallback; (2) Chốt coalescing 200 ms theo realtime §2.5 (snapshot cuối `false` với `seq` tăng dần); (3) Duyệt B18/B19 RuleEditor logic + chuỗi `vi.s30` + draft `enabled:true`. Toàn bộ OQ đã giải quyết xong.
Dev "cloud broker" local = Mosquitto/aedes thứ 2 không auth + script dev mirror status → webhook (thay EMQX Rule Engine). EMQX thật anh test sau.

## Phase
- [x] P0 speckit init (`specify init --here --integration claude --script ps`), constitution/spec giữ nguyên
- [x] P1 monorepo + packages/shared từ contracts + test (main)
- [x] P2a 001 plan/tasks (worktree ../devicenet-wt/001, branch 001-backend-hub-cloud)
- [x] P2b 002 plan/tasks (worktree ../devicenet-wt/002, branch 002-frontend-pwa)
- [x] P3 M-Local implement (hub-agent core + api claim + web S-00/S-10/S-11/S-01/S-20 + LAN) → merge main
- [x] P3z runbook `docs/runbook-local.md` + `pnpm dev`
- [x] P4 phần còn lại 001 (engine, history, infra, installers)
- [x] P5 phần còn lại 002 (S-02, S-30, Me, SH-*, desktop, PWA)

## Log
- 2026-10-18 P0 xong (702411e). Worktrees tạo từ b0f494f. Design canvas live = `1792254951-200a` = local (kiểm 2026-10-18), chưa cần tải lại.
- Đang chạy song song: P1 shared (sonnet, main) · fetch tools (sonnet, main, không commit) · plan 001 (opus, wt/001) · plan 002 (opus, wt/002).
- P1 xong 21c7340: @devicenet/shared (tsup → dist, moduleResolution Bundler), 118 test xanh, không TODO-OQ.
- Tools: Mosquitto 2.0.22 + Z2M 2.14.2 (`node scripts/fetch-tools.mjs`, entry `node .tools/zigbee2mqtt/index.js`, curl vì proxy). Z2M với COM99 treo 40 s không báo lỗi → hub supervisor cần timeout chờ bridge/state. c152428
- P2b plan 002 xong (aba1ec0), main merge vào 002 (e568427). Quyết định OQ 002: OQ-06 không lỗi (FR-A01 set role:"user") → 001 PHẢI set claim role:"user"; OQ-01 root dev thuộc 001; OQ-02 M-Local: Automate = S02-Trong, Me = S03-Me tối thiểu; OQ-03 LAN build → apps/web/dist-lan; OQ-07 VITE_MQTT_URL dev ws://localhost:8084/mqtt, dev broker nhận mọi path. Đang chạy tasks 002.
- P2a plan 001 xong (02d4081), main merge vào 001 (cd60901). 12 OQ của 001 chấp nhận lựa chọn tạm (rename = Z2M description; expireAt ghi Timestamp; libsodium-wrappers; /healthz; dev fallback aedes khi thiếu Mosquitto). Đang chạy tasks 001.
- Tasks: 001 = 1aeb538 (22 batch, M-Local B01–B13, gate B13 = wiring+dev+smoke); 002 = 42ac63b (25 batch, M-Local B01–B16). Brief chung: `.orchestration/implementer-brief.md`.
- Thứ tự 001: G0 B01 → G1 B02∥B05 → G2 B03∥B06(opus)∥B07 → G3 B04(opus)∥B08(opus) → G4 B09∥B10(opus)∥B11∥B12 → G5 B13. Sau: G6 B14(opus)∥B17∥B18∥B19∥B20 → G7 B15(opus)∥B16(opus)∥B21 → G8 B22.
- Thứ tự 002: G0 B01 → G1 B02(haiku)∥B03(haiku)∥B04∥B05(opus) → G2 B06(opus)∥B07∥B08∥B09 → G3 B10(opus) → G4 B11 → G5 B12∥B13∥B14∥B15 → G6 B16. Sau: G7 B17∥B18(opus)∥B20∥B22(opus)∥B23 → G8 B19∥B21 → G9 B24 → G10 B25.
- Merge về main: pnpm-lock.yaml sẽ conflict → lấy bản 1 bên rồi `pnpm install` tái tạo.
- Đang chạy: 001 B01 (haiku), 002 B01 (sonnet).
- 001 B01 ✓ 270f823. Chạy: 001 B02, B05.
- 002 B01 ✓ 3db3697 (deps M-Local cài sẵn; plugin-react@5). Chạy: 002 B02(haiku) B03(haiku) B04(sonnet) B05(opus).
- 001 B02 ✓ 1fe303e. ⚠ better-sqlite3 native binding không tải được (proxy 403, không có compiler) → db.ts fallback node:sqlite (Node 22) sau interface Db. [Đã chốt 2026-10-19: chấp nhận node:sqlite làm mặc định/fallback]. Chạy: 001 B03.
- 001 B03 ✓ f1c49c7. Chạy: 001 B04(opus), B11, B05.
- 002 B04 ✓ 1213492. Chạy: 002 B07.
- 002 B05 ✓ 7f3f973 (22 test transport). Lưu ý: verify dùng `pnpm --filter web exec vitest run <path>`. Chạy: 002 B06(opus).
- 002 B02 ✓ adc1b3b.
- 002 B03 ✓ 38d1410. Chạy: 002 B06(opus) B07 B08 B09.
- 002 B07 ✓ 4bd1bcb. TODO cho B10: test architecture fail vì src/lib/firebase.ts import firebase/firestore ngoài transport/ → chuyển phần Firestore init vào transport/cloud.
- 001 B11 ✓ b38cbfe (Mosquitto spawn thật OK; Z2M thật chưa chạy vì không có dongle).
- 002 B06 ✓ 6bda324 (41 test; OQ-B06-1 toast set.rejected chưa có chuỗi artboard; OQ-B06-2 LWT seq/ts=0 → cho qua + reset seq). Chạy: 002 B10(opus, kèm fix firebase.ts).
- 002 B08 ✓ 7add3a2, B09 ✓ ae77a0e (Row layout chưa đối chiếu artboard → B11+ kiểm lại). Chờ B10 → B11.
- 001 B04 ✓ 3fdf56e (105 test; hubCore.ts là điểm nối cho B10/B12/B13). OQ-13: (a) pairing khi không có cloud → ack internal 'no_cloud'; (b) coalescing 200 ms [Đã chốt 2026-10-19: theo realtime §2.5, snapshot cuối false với seq tăng, spec §8 đã cập nhật]; (c) actions-test.ts. Chạy: 001 B12, B05.
- 001 B12 ✓ cc627fd (startLanServer deps cho B13). Chờ B05 → B06/B07.
- 002 B10 ✓ 5e52d67 (157 test xanh; firebase.ts tách Firestore vào transport/cloud; mqtt default import). Chạy: 002 B11.
- 001 B05 ✓ ed282a2 (bootstrap role:user ✓, 21 emu test). ⚠ Proxy Bosch phá gRPC tới emulator → mọi tiến trình dev cần NO_PROXY/xóa HTTP(S)_PROXY cho 127.0.0.1 (B09/B13 phải xử lý). Chạy emu: node_modules/.bin/firebase emulators:exec (pnpm test:emu treo). Chạy: 001 B06(opus) B07.
- 001 B07 ✓ 5043e8a (webhook route CHƯA đăng ký trong server.ts → B13 phải nối). Chạy: 001 B06(opus) B10(opus).
- 002 B11 ✓ f648255 (171 test; bundle 850 kB → B25). Chạy: 002 B12 B13 B14 B15 (sonnet ∥).
- 001 B06 ✓ 89e8f80 (emu 41/41; libsodium qua createRequire; emulators:exec cần backslash). ⚠ rate-limit claim theo uid chạy trước auth → rơi về IP (sửa ở B19/B22). Chạy: 001 B08(opus) B10(opus).
- 002 B15 ✓ 6c97b6e (nút sửa/xóa chờ B21).
- 002 B14 ✓ 1c1532a (sh1/sh3 chưa có → B21; arrange → B22).
- 002 B12 ✓ 5a843ed (OQ-B12-1: 'Xem hướng dẫn chi tiết' chưa có đích → disabled; chuỗi Linux tạm).
- 002 B13 ✓ e18c6a3. Chạy: 002 B16 (gate M-Local web), B17, B18(opus).
- 001 B08 ✓ 4090d0a (runCli phải gọi trong main.ts ở B13). Chạy: 001 B09, B10(opus).
- 001 B10 ✓ b15f403 (13 test; mqtt.js clean:false mất QoS1 in-flight khi đứt — retained bù bằng republish; child.test backoff flaky dưới tải). Chờ B09 → B13 (gate).
- 002 B16 ✓ a4bbc07 → WEB M-LOCAL XONG (200 test). MERGE 002→main 5a35dc8. OQ-B16-1: quickstart Q1–Q7 chạy sau khi 001 merge. Chạy: 001 B09, B20(haiku infra); 002 B17 B18(opus) B20 B22(opus) B23.
- 001 B20 ✓ 5f27e1b infra (CHƯA validate bằng terraform thật — máy không có terraform; cần `terraform validate` trước khi apply).
- 002 B23 ✓ ab7b5dd. TODO dọn sau G7: hooks.test mock thiếu setRuleEnabled (B17); config.test LAN poll flaky (3 vs 2 lần).
- 002 B17 ✓ 6e0ceee (SH-2 Automate variant lấy chuỗi từ spec §8 vì artboard chỉ có Home; editorTarget hook cho B19; sh6 hook cho B21).
- 001 B09 ✓ d85228c (emu 4 test). Chạy: 001 B13 GATE (nâng lên opus vì tích hợp quan trọng) — kèm runbook-local.md + smoke.
- ⚠ 002 B18 (RuleEditor state) code xong + verify xanh (15 test). [Đã duyệt 2026-10-19: files editor, chuỗi vi.s30.errors, draft enabled:true]. B19 (S-30 UI) đã hoàn thành và tích hợp xanh vào main.
- Chạy: 002 B21 (không stage file B18).
- 002 B20 ✓ c5a4394 (Me/HubDetail/History/Settings; chưa làm kéo sắp site/room).
- 002 B22 ✓ 67c85fe arrange mode (tab bar chưa mờ).
- 002 B21 ✓ 23f5429 (chuỗi sheet ở src/i18n/sheets.ts; RoomEmpty 'Gán thiết bị' → sh3 roomId không có artboard → render rỗng, OQ). Cập nhật B18: file editor của B18 đã lọt vào commit B17 6e0ceee — [Đã duyệt 2026-10-19, OQ-B18-1/OQ-B19-1 đã resolve]. Chạy: 002 B19.
- 002 B19 ✓ 262b1d2 (OQ-B19-1 nhãn sheet ngoài artboard tạm). Chạy: 002 B24, 001 B13.
- 002 B24 ✓ 8607470 desktop (chưa so mắt với artboard). Chạy: 002 B25 (+fix config.test), 001 B13.
- 002 B25 ✓ d667cf9 (265 test xanh, bundle 174 KB gzip; icon PWA là placeholder — chưa có asset design). Chạy: 002 T146+T148; 001 B13.
- 002 T146/T148 ✓ a9632d9 (chuỗi scanClose/scanError tự viết → OQ). 002 HOÀN TẤT, merge → main b7b6c1e. Chờ 001 B13.
- 001 B13 ✓ 689abfb (gate). MERGE 001→main ce5346e. ✅ M-LOCAL XONG trên main: typecheck toàn repo xanh; `pnpm smoke` PASS 34 s (claim → online → webhook → pairing mock → device doc → set cloud+LAN → LWT). Lần đầu fail do emulator cold boot > 60 s → nới 180 s (3381b1d). Runbook: docs/runbook-local.md. CHƯA chạy: dev:real với dongle thật, click UI S-10/S-11 thật.
- Tiếp: 001 post-M-Local G6 B14(opus) B17 B18 B19 → G7 B15(opus) B16(opus) B21 → G8 B22. Merge main vào 001 trước.
- 001 B22 ✓ d1cd4c3 (OQ-B21-1/2 resolved, backoff test deterministic). MERGE 001→main c5c5c64.
- ✅ TẤT CẢ BATCH 001 + 002 XONG. Kiểm chứng cuối trên main (6013150): `pnpm -r typecheck` xanh; test: shared 118, hub-agent 234, api 42 (+ emu 45 ở B19), dev-broker 4, web 268 — tất cả xanh; `pnpm smoke` PASS 31.9 s. Sửa flaky app.test (asyncUtilTimeout 5 s).
- CHƯA kiểm thật: dev:real với dongle + TS011F; click UI trên trình duyệt; terraform validate; SEA exe build; docker compose config; Ctrl+C console thật.
- 2026-10-19: Anh đã duyệt toàn bộ các quyết định kỹ thuật: (1) Chấp nhận `node:sqlite` làm mặc định/fallback; (2) Chốt coalescing 200 ms (realtime §2.5); (3) Duyệt B18/B19 RuleEditor logic + chuỗi `vi.s30` + draft `enabled:true`. Toàn bộ doc/spec/OQ đã đồng bộ. Sẵn sàng cho kiểm thử thực tế với USB Dongle (`pnpm dev:real`) và Web UI.
- 2026-10-20..2026-10-21: Field Hardening & Real Device Integration (14 commits sau 62d605a, kết thúc tại 2358c18):
  * `6d29ba8`: Auth session bootstrap header, VITE_FIREBASE_AUTH_DOMAIN fallback, popup-blocked redirect fallback, quiet ignore closed popup.
  * `93b1b08`: GCP Cloud Run runbook deployment (`docs/runbook-gcp-deploy.md`).
  * `fe8393e` & `80534f2`: Bộ cài đặt native Linux & Windows (SEA bundle, PowerShell packaging `package-agent-win.mjs`, NSSM/systemd, VID:PID dongle probe).
  * `1950584`: Me screen, HubDetailScreen với checkbox unclaim confirmation, site-room hierarchy & activity history.
  * `83742ec`: Realtime MQTT events inbound pipeline (`inbound.ts`) & LAN config HTTP 304 ETag polling (`LanConfigSource.ts`).
  * `927d078`: Automation engine output target state awareness, initial timer evaluation on boot/recompile, chained timeout > 24 ngày (`MAX_TIMEOUT_MS = 24 * 86_400_000`).
  * `196981a` & `abb41ea`: Pre-interviewed device discovery khi `pairing.start`, re-pairing identity migration, driver cache clearing, SQLite conflict deletion cho tombstoned removed records.
  * `f7b4c8e`: Hub claim reset LAN endpoint `POST /setup/reset` và auto-unclaim listener khi xóa hub trên cloud (`onHubDeleted`).
  * `d87d04e`: Tắt tab Tự động hóa (Automate) trong quá trình onboarding & hướng dẫn URL setup LAN.
  * `a644170`: Device lifecycle manager (`lifecycle.ts`) và Z2M `removeDevice` implementation.
  * `3e0ad13`: Auto-healing fallback cho `siteId` mồ côi/lạc hậu trong RuleEditor & config sources, placeholder cho thiết bị rỗng.
  * `2358c18`: Nút xóa điều kiện/hành động RuleEditor, lọc toán tử theo kiểu dữ liệu thuộc tính, giữ trạng thái sub-tab Automate khi chuyển tab.
- ✅ ĐỒNG BỘ SPEC/DOC/TASKS (speckit-deep audit):
  * Cập nhật đầy đủ 001 (backend-hub-cloud) & 002 (frontend-pwa): `spec.md`, `plan.md`, `data-model.md`, `tasks.md` (thêm B23 cho 001, B26 cho 002), `open-questions.md`, và tạo mới `ledger.md` (153 atomic facts: 83 backend, 70 frontend, độ phủ 100%).
  * Trạng thái test & typecheck: `pnpm -r typecheck` 5/5 package sạch; `pnpm test` tổng cộng 686 tests xanh (shared: 118, hub-agent: 245, api: 42, dev-broker: 4, web: 277).

