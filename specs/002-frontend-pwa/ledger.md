# Fact Ledger: 002 – Frontend PWA (`apps/web`)

| L-### | category | fact (verbatim ids/numbers) | source § | covered-by |
|---|---|---|---|---|
| L-001 | config | Single codebase React 19 + Vite 6 + TypeScript builds two variants `VITE_MODE=cloud\|lan` | spec §1 | plan §Technical Context, T001 |
| L-002 | navigation | 3 primary tabs: Home, Automate, Me | spec §1 | app/router.tsx, T001 |
| L-003 | ux-flow | Mobile viewport baseline 390 pt width; desktop breakpoint at ≥ 900 px | spec §1, §4 FR-F11 | plan §Technical Context, T138 |
| L-004 | api | `VITE_FIREBASE_AUTH_DOMAIN` configures custom Firebase Auth domain | spec §4 FR-F00 | env.ts, lib/firebase.ts, T150 |
| L-005 | business-rule | `signInWithGoogle` uses popup, falls back to redirect on `auth/popup-blocked` or iOS standalone | spec §4 FR-F00 | features/auth/firebaseAuth.ts, T150 |
| L-006 | edge-case | Popup cancel errors `auth/popup-closed-by-user` and `auth/cancelled-popup-request` ignored silently | spec §4 FR-F00 | features/auth/LoginScreen.tsx, T150 |
| L-007 | error-code | Authentication error toast shows error code in parentheses for non-cancellation errors | spec §4 FR-F00 | features/auth/LoginScreen.tsx, T150 |
| L-008 | api | Session bootstrap passes `Authorization: Bearer <idToken>` to `POST /v1/tenants/bootstrap` | spec §4 FR-F00 | features/auth/session.ts, T150 |
| L-009 | state-machine | `applyAuthUser` saves idToken and user to store before invoking bootstrap | spec §4 FR-F00 | features/auth/session.ts, T150 |
| L-010 | navigation | Unonboarded tenant without hubs is routed to `/onboarding/hub` (S-10) | spec §4 FR-F00 | app/router.tsx, T051 |
| L-011 | navigation | TabBar and DesktopShell disable the Automate tab during onboarding when 0 hubs are present | spec §4 FR-F01 | components/dn/TabBar.tsx, DesktopShell.tsx, T154 |
| L-012 | ux-flow | StatusBanner shows offline warning when `hubStatus.online=false` ("Hub {tên} đang offline · lần cuối {HH:mm}") | spec §4 FR-F01 | components/dn/Banner.tsx, T065 |
| L-013 | ux-flow | LAN mode shows banner "Đang dùng chế độ LAN · {ip}" | spec §4 FR-F01 | components/dn/Banner.tsx, T065 |
| L-014 | ux-flow | MQTT reconnecting shows banner "Đang kết nối lại…" | spec §4 FR-F01 | components/dn/Banner.tsx, T065 |
| L-015 | ux-flow | RoomChips long-press (500 ms) opens SH-5 edit sheet | spec §4 FR-F01 | features/home/RoomChips.tsx, T066 |
| L-016 | data-model | Deleting a room sets `roomId=null` on all devices in that room and updates layouts | spec §4 FR-F01, FR-F12 | features/me/sheets/RoomSheet.tsx, T119 |
| L-017 | layout | DeviceTile sizes: 1×1 (171×120 pt) and 2×1 (358×120 pt), gap 16, 2 columns on mobile | spec §4 FR-F01 | features/home/DeviceGrid.tsx, T067 |
| L-018 | ux-flow | Primary property formatted in Vietnamese style (e.g. `0,38 W`) | spec §4 FR-F01 | lib/format.ts, T012 |
| L-019 | ux-flow | DeviceTile toggle button min tap target ≥ 44 pt | spec §4 FR-F01, §6 | components/dn/DeviceTile.tsx, T068 |
| L-020 | number | Tile toggle command timeout rollback deadline is 3000 ms | spec §4 FR-F01, D-05 | transport/PendingTracker.ts, T025 |
| L-021 | notification | Rollback shows toast "Không nhận được phản hồi từ {tên}" | spec §4 FR-F01 | transport/HubCommands.ts, T027 |
| L-022 | business-rule | Tile toggle disabled when hub or device is offline | spec §4 FR-F01 | components/dn/DeviceTile.tsx, T068 |
| L-023 | ux-flow | Arrange mode triggered by long-press tile, sets `ui.arranging=true` with `@dnd-kit` | spec §4 FR-F01 | features/home/arrange/ArrangeMode.tsx, T127 |
| L-024 | number | Arrange mode layout changes debounced 500 ms before writing Firestore `layouts` `rev+1` | spec §4 FR-F01 | features/home/arrange/ArrangeMode.tsx, T128 |
| L-025 | navigation | Tap tile body navigates to `/device/$deviceId` (S-20) | spec §4 FR-F01 | features/home/HomeTile.tsx, T069 |
| L-026 | navigation | Automate screen preserves active sub-tab (Tap-to-run / Automation) across navigation | spec §4 FR-F02 | features/automate/AutomateScreen.tsx, T156 |
| L-027 | ux-flow | SceneCard tap executes `sendCommand({type:"scene.run"})` with visual progress ring | spec §4 FR-F02 | features/automate/SceneCard.tsx, T096 |
| L-028 | ux-flow | RuleCard tap navigates to Rule Editor S-30; long-press opens SH-6 menu | spec §4 FR-F02 | features/automate/RuleCard.tsx, T097 |
| L-029 | ux-flow | RuleCard shows syncing badge when `appliedRev !== rev` ("Đã lưu, hub đang nạp…") | spec §4 FR-F02 | features/automate/RuleCard.tsx, T097 |
| L-030 | business-rule | Broken rules disable the enable/disable switch | spec §4 FR-F02 | features/automate/RuleCard.tsx, T097 |
| L-031 | example | SuggestionCard templates: turn off all sockets, porch light, bedtime 23:00, power > 1500 W, sunset | spec §4 FR-F02 | features/automate/suggestions.ts, T098 |
| L-032 | ux-flow | Me screen shows account avatar, name, email, and tenant name | spec §4 FR-F03 | features/me/MeScreen.tsx, T110 |
| L-033 | ux-flow | HubRow displays live status dot, agent version, device count, and site name | spec §4 FR-F03 | features/me/HubRow.tsx, T111 |
| L-034 | ux-flow | HubDetailScreen displays LAN IP address, versions, unclaim action, and restart option | spec §4 FR-F03 | features/me/HubDetailScreen.tsx, T152 |
| L-035 | business-rule | Hub deletion requires confirmation checkbox before executing `DELETE /v1/hubs/{id}` | spec §4 FR-F03 | features/me/HubDetailScreen.tsx, T152 |
| L-036 | ux-flow | Unnamed device banner ("1 thiết bị chưa đặt tên") appears in Hub section if `status=="new"` | spec §4 FR-F03 | features/me/MeScreen.tsx, T112 |
| L-037 | retention | Activity history lists 5 latest events, "Xem tất cả" navigates to 7-day history | spec §4 FR-F03 | features/me/history.ts, HistoryScreen.tsx, T152 |
| L-038 | ux-flow | HistoryScreen groups events by day ("Hôm nay", "Hôm qua", "Thứ X, DD/MM") with filter chips | spec §4 FR-F03 | features/me/HistoryScreen.tsx, T152 |
| L-039 | ux-flow | S-40 Settings offers Vietnamese language, °C/°F, Light/Dark/System theme, and LAN URL link | spec §4 FR-F03 | features/me/SettingsScreen.tsx, T113 |
| L-040 | installer | S-10 StepInstall provides one-click copy commands for Linux (`curl ... | sudo bash ...`) and Windows (`irm ... | iex`) | spec §4 FR-F04 | features/onboarding/hub/StepInstall.tsx, T151 |
| L-041 | number | Claim code input has 8 cells, auto-advances, and filters uppercase base32 `[A-HJ-NP-Z2-9]` | spec §4 FR-F04 | components/dn/CodeInput.tsx, T054 |
| L-042 | number | Claim code validity window is 15 minutes | spec §4 FR-F04, D-09 | features/onboarding/hub/StepCode.tsx, T055 |
| L-043 | ux-flow | QR code scanner on S-10 uses `@zxing/browser` to parse `devicenet://claim?code=` | spec §4 FR-F04 | features/onboarding/hub/QrScan.tsx, T148 |
| L-044 | error-code | Invalid/expired claim code shows shaking red cells with message "Mã sai hoặc đã hết hạn." | spec §4 FR-F04 | features/onboarding/hub/StepCode.tsx, T056 |
| L-045 | number | S-11 device pairing duration is 120 seconds with visual countdown ring | spec §4 FR-F05 | features/onboarding/device/StepFind.tsx, T058 |
| L-046 | business-rule | Pairing blocked with banner if hub is offline | spec §4 FR-F05 | features/onboarding/device/StepFind.tsx, T058 |
| L-047 | ux-flow | FoundDeviceCard shows model, vendor, property count, LQI, and "Đặt tên" button | spec §4 FR-F05 | features/onboarding/device/FoundDeviceCard.tsx, T059 |
| L-048 | ux-flow | Naming step allows setting name, room chip, icon picker, and primary tile property | spec §4 FR-F05 | features/onboarding/device/StepName.tsx, T060 |
| L-049 | ux-flow | S-20 Hero shows large icon, status, primary sensor reading, and large toggle switch | spec §4 FR-F06 | features/device/DeviceHero.tsx, T080 |
| L-050 | ux-flow | Numeric sensors in S-20 open 24-hour PropertyChart on tap | spec §4 FR-F06 | features/device/PropertyChart.tsx, T136 |
| L-051 | business-rule | Offline device in S-20 disables controls and offers "Tìm lại thiết bị" (`device.ping`) | spec §4 FR-F06 | features/device/DeviceScreen.tsx, T082 |
| L-052 | business-rule | SH-4 device removal flow has 2 steps: affected automations warning + final permanent deletion | spec §4 FR-F07 | features/device/DeleteDialog.tsx, T120 |
| L-053 | business-rule | Stale siteId auto-healing: RuleEditorScreen falls back to first valid site if stored siteId is invalid | spec §4 FR-F08 | features/automate/editor/RuleEditorScreen.tsx, T155 |
| L-054 | ux-flow | RuleEditor allows deleting individual conditions and actions via `removeCondition` and `removeAction` | spec §4 FR-F08 | features/automate/editor/{ConditionSheet.tsx,ActionSheet.tsx}, T156 |
| L-055 | validation | RuleEditor comparison operators filtered by property type (binary: eq/neq; numeric: 7 ops; enum: eq/neq) | spec §4 FR-F08 | features/automate/editor/fields.tsx, T156 |
| L-056 | ux-flow | RuleEditor sheet displays empty device placeholder when no devices match in current site | spec §4 FR-F08 | features/automate/editor/{TriggerSheet.tsx,ConditionSheet.tsx,ActionSheet.tsx}, T155 |
| L-057 | number | Rule test button executes `actions.test` and renders inline step-by-step progress | spec §4 FR-F08 | features/automate/editor/RuleEditorScreen.tsx, T101 |
| L-058 | ux-flow | SH-3 quick edit sheet allows updating name, room, icon (8 choices), and primary property | spec §4 FR-F10 | features/device/QuickEditSheet.tsx, T121 |
| L-059 | layout | Desktop ≥ 900 px renders 240 px left sidebar with logo, site switcher, vertical nav, hub card | spec §4 FR-F11 | app/DesktopShell.tsx, T138 |
| L-060 | layout | D-Home desktop view renders 4-column device grid with max-width 1000 px | spec §4 FR-F11 | features/home/HomeScreen.tsx, T139 |
| L-061 | layout | D-RuleEditor desktop view renders 2-column layout (editor cards left, preview/status cards right) | spec §4 FR-F11 | features/automate/editor/RuleEditorDesktop.tsx, T140 |
| L-062 | layout | Modal sheets on desktop transform into centered dialogs of width 480 px with rounded corners 20 px | spec §4 FR-F11 | components/dn/Sheet.tsx, T141 |
| L-063 | number | Toast notifications auto-dismiss after 4 seconds (8 seconds for actionable toasts) | spec §4 FR-F14 | stores/toast.ts, components/dn/Toast.tsx, T070 |
| L-064 | nfr | Initial JS bundle size < 250 KB gzip with lazy loading for Recharts, RuleEditor, and ZXing | spec §5, §7 | vite.config.ts, router.tsx, T147 |
| L-065 | api | Inbound pipeline parses realtime MQTT events `t/{tenant}/h/{hubId}/events/+` | spec §3 | transport/inbound.ts, T153 |
| L-066 | api | LAN ConfigSource supports HTTP 304 Not Modified when ETag matches, avoiding re-renders | spec §3 | transport/lan/LanConfigSource.ts, T153 |
| L-067 | edge-case | Multiple rapid tile toggles maintain independent pending states and roll back only non-matching tiles | spec §9 | transport/PendingTracker.ts, T025 |
| L-068 | edge-case | Out-of-order state events with older `seq` are ignored by SeqGate | spec §9 | transport/SeqGate.ts, T024 |
| L-069 | edge-case | Device with `status=="new"` is hidden from Home grid, shows "1 thiết bị chưa đặt tên" in Me | spec §9 | features/home/DeviceGrid.tsx, features/me/MeScreen.tsx, T067, T112 |
| L-070 | edge-case | Rule duration input in minutes converts to seconds on wire (`for = minutes * 60`) | spec §9, D-13 | features/automate/editor/TriggerSheet.tsx, T100 |
