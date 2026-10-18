# Brief chung cho agent implement một batch (đọc trước khi làm)

1. Chỉ làm đúng batch được giao trong `specs/<feature>/tasks.md`. Đọc: mục "Conventions" + mục batch của mình trong tasks.md; các mục plan.md/research.md mà task trỏ tới; contract trong `packages/shared/src` (import `@devicenet/shared`, cấm định nghĩa lại type); `docs/realtime-and-events.md` khi task đụng realtime. Không đọc toàn bộ spec nếu không cần — giữ context nhỏ.
2. Theo quy trình `.claude/skills/speckit-implement/SKILL.md` nhưng CHỈ cho các task của batch mình: làm theo thứ tự, test đi kèm, đánh `[X]` vào task trong tasks.md khi xong.
3. Agent khác có thể đang làm batch khác cùng worktree. Không sửa file thuộc batch khác (xem "files" trong tasks.md). Không `git add -A`; chỉ stage file của mình + tasks.md. Commit: `feat(<scope>): <Bxx> <tên batch>` + dòng trống + `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Gặp `index.lock` → đợi vài giây rồi thử lại.
4. Thêm dependency: hạn chế; nếu bắt buộc dùng `pnpm add --filter <pkg>`; lỗi lockfile do chạy đồng thời → chạy lại `pnpm install`.
5. UI (apps/web): trước khi dựng màn, mở artboard `design/<tên>.dc.html` ghi trong task, bám đúng bố cục/thứ tự/component/chuỗi; token từ `design/ds/devicenet/tokens.json`/`dn.css`; chuỗi vào `apps/web/src/i18n/vi.ts`. Canvas đã kiểm: bản `1792254951-200a` = local. Không có artboard → ghi open-questions.md, không tự thiết kế.
6. Mâu thuẫn spec/contract → ghi `specs/<feature>/open-questions.md` với lựa chọn tạm `TODO-OQ`, làm tiếp. Không sửa `packages/shared`, `specs/000-*`, `spec.md`, `design/`, constitution.
7. Test: Vitest unit/integration nhanh. Cấm e2e chạy lâu, cấm lệnh treo (server/watch) không có timeout; tự kill tiến trình nền đã mở. Kết thúc bằng lệnh verify của batch — phải xanh trước khi commit. Nếu không xanh được sau nỗ lực hợp lý: commit phần chạy được với `WIP` trong message và báo rõ.
7b. Lọc test: `pnpm --filter <pkg> exec vitest run <path>` (không dùng `test -- <path>`).
8. Báo cáo cuối ≤ 120 từ: task xong, lệnh verify + kết quả, TODO-OQ mới, commit hash, việc dở.
