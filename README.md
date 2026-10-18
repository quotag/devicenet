# DeviceNet Spec Pack (cho GitHub Spec Kit, monorepo một repo)

Sinh ngày 2026-10-17 từ: PRD, Tech Description, Design Spec, Design "DeviceNet – Wireframes" (https://claude.ai/artifact/4DL1hLUTNtHsJZdr2ACb1W, bản local ở `design/`).

```
.specify/memory/constitution.md          # nguyên tắc + ràng buộc; /plan, /tasks phải tuân
specs/000-shared-contracts/
  data-model.md                          # quyết định D-01..D-17, thực thể, 7 luồng bắt tay
  contracts/ids.ts property.ts rule.ts mqtt.ts firestore.ts index.ts   # → copy nguyên vào packages/shared/src
  contracts/api.openapi.yaml             # Cloud Run API
  contracts/hub-lan.openapi.yaml         # hub-agent LAN API
  contracts/firestore.rules              # → infra/firestore.rules
specs/001-backend-hub-cloud/spec.md      # hub-agent + api + infra + installers
specs/002-frontend-pwa/spec.md           # PWA
docs/realtime-and-events.md              # kỹ thuật realtime bắt buộc + 12 điều cấm
design/                                  # bản tải về của Design (34 artboard + tokens + design system); README.md = bảng artboard ↔ màn + cách tải lại
```

## Cách dùng với Spec Kit
1. `specify init devicenet --ai claude` (hoặc copy vào repo đã có), rồi chép thư mục này đè lên (`.specify/memory/constitution.md` thay bản mặc định).
2. Chạy `/constitution` để Spec Kit nhận constitution hiện có (không viết lại).
3. Thứ tự: `/specify` không cần vì spec đã có → `/plan` cho `000-shared-contracts` trước (chỉ sinh `packages/shared` từ `contracts/` + test), merge; rồi `/plan` → `/tasks` → `/implement` cho `001`, sau đó `002` (002 dev song song được với mock MQTT/Firestore emulator).
4. Khi `/plan` hỏi "technical context", dán đoạn **Ràng buộc kỹ thuật** của constitution.
5. Mỗi khi agent muốn đổi payload/schema → phải sửa `specs/000-shared-contracts/contracts/` + `data-model.md` trước, PR riêng.
6. **UI theo Design (constitution VIII):** Design chưa chốt cuối ở bước `/plan`, `/tasks` — chỉ dùng để xác định màn/state/component, mỗi task UI ghi artboard (bảng ở `design/README.md` và spec 002 §4.0). Ở `/implement`: kiểm tra phiên bản canvas, tải lại nếu đổi, rồi bám sát artboard. Không có artboard hoặc không đọc được → dừng, ghi `specs/002-frontend-pwa/open-questions.md`, báo lại; không tự thiết kế.

## Việc cần anh sửa trong 4 artifact gốc (để đồng bộ với contract)
- **Wireframe S-10 Nhập mã**: "Mã hết hạn sau 10 phút" → **15 phút** (D-09).
- **Wireframe S-30 Sheet trigger**: thêm phép so sánh ≠, ≤, ≥, "đổi sang" (hiện chỉ có 3).
- **Wireframe S-40**: bỏ toggle "Tự dùng chế độ LAN khi có thể" và dòng "đang online qua LAN" (D-17); ẩn "Xóa tài khoản" (D-16).
- **Design Spec §Visual direction**: gap lưới 12 → **16** (khớp §Đặc tả và wireframe).
- **PRD S-01**: menu + thêm mục "Sắp xếp tile"; **PRD US-13**: ghi rõ remote dùng `history.get` qua MQTT (không Firestore snapshots ở v1).
- **Tech Description**: (1) hub dùng **client SDK + custom token**, không Admin SDK; (2) `hubs.online` do **EMQX webhook → Cloud Run** mirror; (3) 4 ô bảng bị cắt bởi ký tự `|` (`cmd` payload, `members.role`, `devices.status`, trigger `sun`) → ghi lại đầy đủ theo `mqtt.ts`/`firestore.ts`/`rule.ts`; (4) thêm topic `pairing`, `runs`, cmd `history.get`, `actions.test`, `device.ping`; (5) state payload có `at{}` theo property; (6) `status` có `z2mVersion`, `lanUrl`, `ip`; (7) friendly_name Z2M = `dev_<ULID>` cố định, rename chỉ đổi `description`.
- ~~**Wireframe thiếu**: SH-3 (sửa nhanh), desktop 1280~~ → **đã có trong Design** (`SH3-SuaNhanh`, `D-Home`, `D-RuleEditor`), kiểm chứng 2026-10-17. S-11 bước 1 chọn hub: chỉ có trong Stepper, v1 ẩn khi 1 hub.
- **Đã kiểm chứng trong Design (2026-10-17)**: các mục wireframe ở trên (S-10 15 phút, S-30 đủ 7 phép so sánh, S-40 bỏ toggle LAN + ẩn "Xóa tài khoản", gap 16, SH-2 "Sắp xếp tile") đều đã sửa. OQ-3..OQ-9 đã chốt và bổ sung vào Design bản `1792254951-200a` (SH-5, SH-6, chi tiết hub, lịch sử 7 ngày, toast, desktop màn khác) — xem spec 002 §10.

## Kiểm tra nhanh contracts
```
cd specs/000-shared-contracts/contracts && npm i zod@3 typescript && npx tsc --noEmit --strict --module esnext --target es2022 --moduleResolution bundler *.ts
```
