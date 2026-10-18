# Contracts — 001 Backend

**No contract is defined in this folder.** Feature 001 implements, and never redefines, the contracts in `specs/000-shared-contracts/contracts/` (consumed as `@devicenet/shared`):

| Interface 001 exposes / consumes | Contract (source of truth) | Implemented by |
|---|---|---|
| MQTT topics + payloads (status, state, set, cmd/ack, pairing, runs, events) | `000/contracts/mqtt.ts` | `apps/hub-agent/src/bridge`, `core`, `automation` |
| Property model, `validateValue`, `isWritable`, `accessFromZ2M` | `000/contracts/property.ts` | `apps/hub-agent/src/drivers/zigbee2mqtt` |
| Rule / Scene / Action / Trigger | `000/contracts/rule.ts` | `apps/hub-agent/src/automation` |
| Firestore documents + writer matrix | `000/contracts/firestore.ts`, `firestore.rules` | hub `sync/`, api `routes/`, `infra/firestore.rules` (verbatim copy) |
| Cloud REST API | `000/contracts/api.openapi.yaml` | `apps/api` |
| Hub LAN REST API | `000/contracts/hub-lan.openapi.yaml` | `apps/hub-agent/src/lan` |

Hub-internal interfaces (not shared, not on a wire):
- `Driver` — signature fixed by spec FR-H03 (copied into `apps/hub-agent/src/drivers/Driver.ts`).
- `ConfigStore` (Firestore abstraction for testability), `MqttLink`, `Publisher`, `Clock/TimerHost` — internal, documented in `plan.md` §Architecture.

Conflicts between spec and these contracts: `../open-questions.md`. A contract change requires a separate PR to `000` (constitution II).
