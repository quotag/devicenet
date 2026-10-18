# DeviceNet – Design (bản local)

Tham chiếu UI của `apps/web`, tải về từ canvas Design "DeviceNet – Wireframes". Design **vẫn có thể đổi** cho tới lúc implement: ở `/plan`, `/tasks` dùng để xác định màn, state, component; ở `/implement` mới phải bám sát từng chi tiết (xem quy tắc dưới).

| | |
|---|---|
| Nguồn | https://claude.ai/artifact/4DL1hLUTNtHsJZdr2ACb1W |
| Phiên bản canvas | `1792254951-200a` (v16) |
| Design system | DeviceNet (`ds/devicenet/`), bản `1792176116-2e63` từ https://claude.ai/artifact/6qgRoqzMDeWUCW4MnzQxqD |
| Tải về | 2026-10-17 |

Chỉ chép phần `project/` của canvas (artboard + CSS/JS dùng chung + design system). Runtime của trình editor (`support.js`, `artifact-type/`) **không** chép, nên mở file `.dc.html` trực tiếp bằng trình duyệt sẽ không render đúng: đọc mã nguồn, hoặc mở link canvas ở trên để xem trực quan.

## Quy tắc cho agent làm UI
1. `/plan`, `/tasks`: dùng bảng dưới để biết màn/state/component nào tồn tại; mỗi task UI ghi artboard nó dựng. Không chép chi tiết pixel vào plan (Design còn đổi).
2. `/implement`, trước mỗi task UI: kiểm tra phiên bản canvas (tải lại nếu khác bảng trên), mở artboard, lấy **bố cục, thứ tự phần tử, component, chuỗi UI, state** từ đó. Màu/khoảng cách/bo góc/chữ lấy từ `ds/devicenet/tokens.json` (và biến CSS trong `dn.css`).
3. Không tự thiết kế. Màn/state không có artboard, hoặc không đọc được file → **dừng, ghi vào `specs/002-frontend-pwa/open-questions.md` và báo người phụ trách**.
4. Design và spec lệch nhau → Design thắng về giao diện + chuỗi UI; spec/contract thắng về dữ liệu + hành vi. Lệch về hành vi → dừng, ghi open question.
5. Không sửa file trong thư mục này bằng tay. Design đổi → tải lại từ canvas (mục cuối).

## Cấu trúc
```
canvas.json                    # index: tên artboard, kích thước, thứ tự, design system
*.dc.html                      # mỗi file = 1 artboard (markup + renderVals() chứa chuỗi theo state)
dn.css                         # biến CSS token (sáng/tối) + khung màn hình dùng chung (.hdr, .tabbar, .row, .card…)
dn-icons.js                    # bộ icon thiết bị (lucide, stroke 1.75): plug, toggle, bulb, fan, temp, zap, motion, door, router
ds/devicenet/tokens.json       # design token gốc: color (light/dark), type, spacing, radius, size
ds/devicenet/components/       # bundle tham chiếu của component DeviceNet.* (React) — xem để dựng lại, không import vào app
```
Đọc artboard: phần `<x-dc>` là giao diện; `<x-import component-from-global-scope="DeviceNet.X" …>` là component của design system với props; `data-props` khai báo các state xem được (vd. `mode: offline|lan|reconnecting`), chuỗi theo state nằm trong `renderVals()`.

## Bảng artboard ↔ màn hình
| Màn | Artboard | Khung |
|---|---|---|
| S-00 Đăng nhập | `Main.dc.html` | 390×844 |
| S-10 Thêm hub · 1 Cài agent | `S10-CaiAgent.dc.html` | 390×844 |
| S-10 · 2 Nhập mã | `S10-NhapMa.dc.html` | 390×844 |
| S-10 · 2 Mã sai | `S10-MaSai.dc.html` | 390×844 |
| S-10 · 3 Kết nối | `S10-KetNoi.dc.html` | 390×844 |
| S-01 Home · mặc định | `S01-Home.dc.html` | 390×844 |
| S-01 · hub offline / LAN / đang kết nối lại | `S01-Offline.dc.html` (prop `mode`) | 390×844 |
| S-01 · sắp xếp | `S01-SapXep.dc.html` | 390×844 |
| S-01 · trống / room trống / loading | `S01-Trong.dc.html` (prop `state`) | 390×844 |
| SH-1 Chọn site | `SH1-ChonSite.dc.html` | 390×844 |
| SH-2 Menu + | `SH2-MenuThem.dc.html` | 390×844 |
| S-11 · 2 Tìm thiết bị | `S11-TimThietBi.dc.html` | 390×844 |
| S-11 · 3 Đặt tên | `S11-DatTen.dc.html` | 390×844 |
| S-11 · hết giờ | `S11-HetGio.dc.html` | 390×844 |
| S-02 Automate · Tap-to-run | `S02-Scene.dc.html` | 390×844 |
| S-02 · Automation | `S02-Automation.dc.html` | 390×844 |
| S-02 · trống (scene/automation) | `S02-Trong.dc.html` (prop `tab`) | 390×844 |
| S-30 Soạn automation | `S30-RuleEditor.dc.html` | 390×1100 |
| S-30 · chưa hợp lệ | `S30-ChuaHopLe.dc.html` | 390×1100 |
| S-30 · sheet chọn trigger | `S30-ChonTrigger.dc.html` | 390×844 |
| S-20 Chi tiết thiết bị (+ pending) | `S20-ChiTiet.dc.html` (prop `pending`) | 390×1040 |
| S-20 · offline | `S20-Offline.dc.html` | 390×1040 |
| SH-3 Sửa thiết bị nhanh | `SH3-SuaNhanh.dc.html` | 390×844 |
| SH-4 Xác nhận xóa · bước 1/2 | `SH4-XacNhanXoa.dc.html` (prop `step`) | 390×844 |
| S-03 Me · online / hub offline / chưa có hub | `S03-Me.dc.html` (prop `state`) | 390×844 |
| S-40 Cài đặt | `S40-CaiDat.dc.html` | 390×844 |
| S-03 · chi tiết hub, gỡ hub | `S03-ChiTietHub.dc.html` (prop `state`, `confirm`) | 390×844 |
| S-03 · lịch sử 7 ngày | `S03-LichSu.dc.html` (prop `state` data/empty) | 390×844 |
| S-03 · dòng "1 thiết bị chưa đặt tên" | `S03-Me.dc.html` (prop `unnamed`) | 390×844 |
| SH-5 Sửa / xóa / thêm room, thêm site | `SH5-SiteRoom.dc.html` (prop `mode` edit/confirm/newRoom/newSite/pick) | 390×844 |
| SH-6 Giữ lâu scene/automation · xác nhận xóa | `SH6-XoaAutomation.dc.html` (prop `step` menu/confirm) | 390×844 |
| Toast | `S01-Toast.dc.html` (prop `kind` timeout/error/update) | 390×844 |
| Desktop · Home lưới 4 cột | `D-Home.dc.html` | 1280×900, fluid |
| Desktop · Rule Editor 2 cột | `D-RuleEditor.dc.html` | 1280×900, fluid |
| Desktop · màn khác (mẫu: Chi tiết thiết bị; sheet → dialog) | `D-ChiTiet.dc.html` (prop `dialog`) | 1280×900, fluid |

Không có artboard riêng (có quy ước, không cần vẽ): S-11 bước 1 Chọn hub — v1 mỗi site một hub nên bước này tự hoàn tất, Stepper hiện ✓; trạng thái loading S-00 ngoài nút. Mọi màn khác chưa có ở bảng trên → open question, không tự dựng.

## Tải lại khi Design đổi
Trong Claude Code: yêu cầu agent "tải lại design từ canvas" — agent đọc canvas bằng Artifact tool (`action: list, scope: files` rồi `read` mọi đường dẫn `project/…`), chép đè vào `design/` (bỏ tiền tố `project/`), cập nhật bảng "Phiên bản canvas" ở trên, rồi đối chiếu lại `specs/002-frontend-pwa/spec.md` (§8 chuỗi UI, §4 FR). Agent **không đọc được** canvas → báo lại, không đoán.
