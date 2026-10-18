# Contracts for 002

## External contracts — defined in 000, never duplicated here
| Interface | Source | Web usage |
|---|---|---|
| MQTT topics, payloads, QoS, timeouts | `specs/000-shared-contracts/contracts/mqtt.ts` → `@devicenet/shared` | `transport/MqttClient`, `inbound`, `HubCommands` |
| Firestore docs + writer matrix | `firestore.ts`, `firestore.rules` | `transport/cloud/*`, `transport/writes.ts` (presentation fields only) |
| Rule / Scene / summaries | `rule.ts` | S-02, S-30, SH-4/SH-6 (`referencedIds`) |
| Property / values | `property.ts` | DeviceTile, S-20 controls (`validateValue`, `isWritable`) |
| Cloud REST | `api.openapi.yaml` | `lib/api.gen.ts` (generated) — bootstrap, claim, delete hub |
| Hub LAN REST | `hub-lan.openapi.yaml` | LAN `ConfigSource` (`/api/config`), `HistorySource` (`/api/history`) |

## Internal contract: transport ⇄ features (`src/transport/hooks.ts`)
Features import only these; they never touch `mqtt`, `firebase/firestore` or stores' setters.

| Hook / fn | Returns | Notes |
|---|---|---|
| `useDevices(siteId, filter)` | `Device[]` (active, ordered) | from `config` + layout |
| `useDevice(id)` | `Device \| undefined` | |
| `useDeviceState(id)` | `{values, at, online, lastSeen, lqi, pending: Set<key>} \| undefined` | display values merge pending |
| `useSetValues()` | `(deviceId, values) => void` | registers pending; throws if offline |
| `useSendCommand()` | `(hubId, Command) => Promise<CommandAck>` | rejects `HubTimeoutError` after 5 s |
| `useHub(siteId)` / `useHubStatus(hubId)` | `Hub`, `{online, status, lanUrl, …}` | MQTT first, Firestore fallback |
| `usePairing(hubId)` | `{active, remainingMs, found}` | remaining via `hubNow()` |
| `useConnection()` | `{mqtt, mode}` | banners |
| `useSites()`, `useRooms(siteId)` | `Site[]`, `Room[]` | |
| `useConfigWrites()` | `ConfigWrites \| null` | `null` in LAN build; `updateDevicePresentation`, `createRoom`, `renameHub` (M-Local); rules/scenes/layouts later |
| `useHubNow(hubId)` | `() => number` | for "x giây trước" |

Fake implementation `test/fakeTransport.ts` backs screen tests with the same API.
