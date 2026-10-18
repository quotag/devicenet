# DeviceNet Constitution

Phiên bản 1.2.0 · Áp dụng cho mọi feature spec trong repo. `/plan` và `/tasks` phải kiểm tra tuân thủ trước khi sinh.

## Nguyên tắc cốt lõi (theo thứ tự ưu tiên khi xung đột)

### I. Hub-first: mọi điều khiển và automation chạy ở hub
Cloud chỉ giữ cấu hình, xác thực, và mở đường truy cập từ xa. Không có logic điều khiển thiết bị trong `apps/api`. Khi mất internet: automation vẫn chạy, trang LAN vẫn bật/tắt được, log xếp hàng tại hub và đồng bộ sau.

### II. Contract-first: `packages/shared` là nguồn sự thật
Mọi payload MQTT, document Firestore, body REST, schema rule/property được định nghĩa bằng Zod trong `packages/shared` (sinh từ `specs/000-shared-contracts/contracts/`). FE, hub-agent, api **chỉ import từ đó**; không được định nghĩa lại type cục bộ, không được "nới" schema trong một app. Thay đổi contract = PR riêng, cập nhật `data-model.md` cùng lúc.

### III. Tách tenant ở ba lớp độc lập
Firestore Rules (custom claim `tenant`), EMQX ACL (`t/{tenant}/#`), api kiểm tra `tenant` của token với tài nguyên. Mọi topic bắt đầu `t/{tenant}/`. Không endpoint/truy vấn nào trả dữ liệu không lọc theo tenant. Hub dùng **client SDK + custom token**, không bao giờ Admin SDK.

### IV. Realtime đi qua MQTT, cấu hình đi qua Firestore listener, không có polling
State retained; lệnh có `id` + ack + timeout; cấu hình `onSnapshot` hai đầu với `rev/appliedRev`. Cấm `setInterval` để hỏi state hay rule. Ngoại lệ duy nhất: LAN build poll `GET /api/config` 30 s vì không có Firestore.

### V. Nói thật về trạng thái
UI chỉ hiện "đã bật" khi có `state` thật; pending có spinner; offline/LAN/đang kết nối lại có banner. Không optimistic quá 3 s. Rule chỉ báo "đã nạp" khi `appliedRev === rev`.

### VI. Test tối thiểu bắt buộc
- `packages/shared`: 100% schema có test parse hợp lệ + không hợp lệ; `summarizeTrigger/Action` có snapshot test tiếng Việt.
- hub-agent: test adapter `exposes → Property` với fixture TS011F; test engine cạnh lên + `for`; test scheduler múi giờ Asia/Ho_Chi_Minh và sun calc.
- api: test claim flow (happy, expired, used, other tenant); test rules bằng Firebase emulator.
- web: test transport (mock MQTT) cho optimistic/rollback; test RuleEditor validate.
Không merge khi thiếu nhóm test tương ứng với phần code đổi.

### VII. Một người vận hành
Monorepo pnpm, một lệnh `pnpm dev` chạy emulator Firestore + Mosquitto + hub-agent mock Z2M + web. Terraform cho cloud. Không thêm dịch vụ/queue/DB ngoài: Firestore, EMQX, Cloud Run, Hosting, SQLite ở hub.

### VIII. Design-first: UI dựng theo `design/`, không tự thiết kế
`design/` (bản tải về của canvas Design "DeviceNet – Wireframes", xem `design/README.md`) là tham chiếu giao diện của `apps/web`: bố cục, component, state, chuỗi UI tiếng Việt, token màu/chữ/khoảng cách/bo góc (`design/ds/devicenet/tokens.json`). Design **còn có thể đổi** cho tới lúc implement, nên áp dụng theo giai đoạn:
- `/plan`, `/tasks`: Design xác định **phạm vi** (có màn/state/component nào). Mọi task UI ghi **artboard** nó dựng (vd. `design/S01-Home.dc.html`); không chép chi tiết pixel/chuỗi vào plan, chỉ trỏ tới artboard và spec §8.
- `/implement`: trước mỗi task UI, kiểm tra phiên bản canvas trong `design/README.md` (khác bản live → tải lại), đọc artboard và **bám sát** bố cục, component, chuỗi, token.
- Màn hoặc state **không có artboard**, hoặc **không đọc được** file design → **dừng, ghi `specs/002-frontend-pwa/open-questions.md`, báo người phụ trách**. Cấm tự nghĩ ra bố cục, màu, chuỗi.
- Design lệch spec: Design thắng về giao diện và chuỗi UI; spec/contract thắng về dữ liệu và hành vi (lệch hành vi → dừng, open question).
- Không sửa `design/` bằng tay; Design đổi → tải lại từ canvas theo `design/README.md`, rồi đối chiếu lại spec 002.

## Ràng buộc kỹ thuật (không thương lượng trong v1)
- Node.js 22 LTS, TypeScript strict, ESM. React 19 + Vite 6, Tailwind 4, shadcn/ui, TanStack Router/Query, Zustand, mqtt.js 5, Zod 3, Fastify 5, better-sqlite3, pino.
- Zigbee2MQTT và Mosquitto khóa phiên bản trong installer.
- Thời gian trên wire: epoch ms number. Id: `<prefix>_<ULID>`.
- Giá trị binary: boolean. Đơn vị thời gian trong rule: giây.
- Tiếng Việt là ngôn ngữ UI mặc định; chuỗi UI để trong `apps/web/src/i18n/vi.ts`, không hard-code trong component.
- shadcn/ui chỉ dùng làm primitive (hành vi, a11y); giao diện component phải khớp `design/ds/devicenet/` (tên component trùng `DeviceNet.*`: Button, Chip, Switch, Slider, SegmentedTabs, Card, Sheet, Banner, Badge, Input, Stepper, DeviceTile).

## Quy trình
- Feature spec theo Spec Kit: `specs/NNN-ten/spec.md → plan.md → tasks.md`. `000-shared-contracts` phải xanh trước khi `001`/`002` chạy `/tasks`.
- Mỗi task kết thúc bằng lệnh kiểm chứng chạy được (`pnpm test --filter …`, `pnpm typecheck`).
- Agent gặp mâu thuẫn giữa spec và contract → **dừng, ghi vào `specs/…/open-questions.md`**, không tự quyết.

## Governance
Constitution thắng mọi tài liệu khác trong repo. Sửa constitution = PR có mục "Lý do" và cập nhật version (semver: thay đổi nguyên tắc = major).

**Version**: 1.2.0 | **Ratified**: 2026-10-17 | **Last Amended**: 2026-10-17

### Lịch sử sửa đổi
- 1.1.0 (2026-10-17): thêm nguyên tắc VIII Design-first. Lý do: Design đã đủ màn (gồm SH-3, Desktop 1280) và được tải về `design/`; agent điều phối UI phải dựng theo Design thay vì tự thiết kế. Thêm nguyên tắc mới, không đổi nguyên tắc cũ → minor.
- 1.2.0 (2026-10-17): VIII áp dụng theo giai đoạn (`/plan`, `/tasks`: phạm vi; `/implement`: bám sát). Lý do: Design chưa chốt cuối ở bước plan. Làm rõ cách áp dụng, không đổi nguyên tắc → minor.
