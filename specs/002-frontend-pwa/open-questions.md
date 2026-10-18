# Open questions — 002 Frontend PWA

spec.md, 000 contracts, design/ and constitution are not edited. New items found at implement time: add a row with a tentative **TODO-OQ** choice and continue (or stop if constitution VIII requires).

## Resolved (orchestrator, 2026-10-18)

| ID | Question | Decision |
|---|---|---|
| OQ-01 | Ownership of root workspace / `pnpm dev` | Root `pnpm dev`/`dev:real` + `tools/dev-cloud-broker` owned by 001. Web owns only `apps/web` scripts: `dev`, `build`, `build:lan`, `test`, `typecheck`. |
| OQ-02 | What Automate/Me tabs show in M-Local | Automate = `S02-Trong` empty state only (static, no rule data). Me = minimal `S03-Me`: account card, Hub row with online state, Đăng xuất. Both from their artboards; full versions post-M-Local. |
| OQ-03 | LAN build output for hub-agent | `apps/web/dist-lan`; hub-agent serves that path (configurable). |
| OQ-04 | "Room mới" chip in S-11 step 3 / SH-3 | Opens SH-5 `newRoom` (`SH5-SiteRoom` `mode=newRoom`); only this mode in M-Local. |
| OQ-05 | QR scan on S-10 in M-Local | Deferred post-M-Local; button present per artboard, disabled until then. |
| OQ-06 | `firestore.rules` `isUser()` needs `token.role` | Not an issue: 001 FR-A01 bootstrap sets custom claims `{tenant, role:"user", acl}`; web relies on it. |
| OQ-07 | Dev cloud broker ws path | Web uses full `VITE_MQTT_URL`; dev default `ws://localhost:8084/mqtt` (mimics EMQX); dev broker accepts any path. |
| OQ-08 | LAN MQTT host (`location.host` includes `:8080`) | Use `ws://${location.hostname}:9001`. |
| OQ-09 | Hub rename / "Site mới" in S-10 step 3 | Firestore update `hubs/{id}.name`/`siteId` (user-writable); "Site mới" creates a site doc first. |
| OQ-10 | Toast wording when a `cmd` ack times out | Reuse `timeout` kind with hub name; confirm wording against `S01-Toast` at implement time, stop per VIII if absent. |
| 001-OQ-4 | Hub writes `events.expireAt` as Firestore `Timestamp` (TTL) but Zod `EventDoc.expireAt` is a number | Web's Firestore events reader converts any `Timestamp` field (`expireAt`) → epoch ms (`toMillis()`) **before** `EventDoc.parse` (task in S-03 history batch). |
| OQ-B06-1 | Toast text for hub event `set.rejected` (no artboard string; `S01-Toast` only has timeout + delete error) | TODO-OQ: show `error` kind with the `toast.timeout(deviceName)` text; replace when an artboard string exists. |
| OQ-B06-2 | LWT `status` (`hubLwt()`: `ts:0, seq:0`) can never pass `SeqGate` | `inbound.ts` bypasses the gate for `online:false, ts:0` and forgets the topic's seq history. |
| OQ-B10-1 | B10 Verify `! grep -rl "firestore" dist-lan/assets` false-positives on the env field name `firestoreEmulatorHost` (src/env.ts, bundled in LAN too) | TODO-OQ: check for Firestore SDK code instead: `! grep -rlE "initializeFirestore|persistentLocalCache|onSnapshot" apps/web/dist-lan/assets` (passes; also verified with transport imported into the LAN entry). |
| OQ-B12-1 | S-10 "Xem hướng dẫn chi tiết" destination, Linux install command/note (artboard shows Windows only) | TODO-OQ: guide button disabled; Linux strings in `vi.s10.installCmd[1]`/`installNote[1]` are provisional. |
| OQ-B18-1 | S-30 validation messages: artboards only show "Cần ít nhất 1 hành động để lưu" | TODO-OQ: other `vi.s30.errors` strings authored by B18 (e.g. "Nhập giá trị", "Chọn thiết bị"); replace when an artboard lists them. New drafts default `enabled: true` (S30-ChuaHopLe Switch checked + disabled). |

## Open

None.

| ID | Question | Decision |
|---|---|---|
| OQ-B16-1 | Quickstart Q1–Q7 need the 001 stack (not merged in this worktree) | TODO-OQ: T096 not executed; verified by unit tests + `build`/`build:lan`/`typecheck`. Re-run Q1–Q7 against `pnpm dev` after 001 merges. LAN checks to do then: banner IP, MQTT `ws://{hostname}:9001`, `/api/config` 30 s poll, hub-agent serving `apps/web/dist-lan`. |

## OQ-B19-1 — S-30 strings not in artboards (TODO-OQ)
Sheet labels beyond the 3 artboards (condition kinds, action sheet fields, day chips, offset/level labels, icon picker, run-step status words) are provisional Vietnamese in `vi.s30`; icon picker reuses `getIconPickerList()` (8 device icons) since no icon artboard exists. S-30 is route `/automate/editor` (target handed via `editorNav.ts`; reload returns to S-02).
