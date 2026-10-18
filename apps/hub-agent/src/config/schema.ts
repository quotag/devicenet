import { z } from 'zod';

/** Hub-internal config (config.yaml). Not a shared contract. See data-model.md §1. */
export const HubConfig = z.object({
  serialPort: z.string().default('auto'),
  dataDir: z.string().default('./.data/hub'),
  apiBaseUrl: z.string().url().default('http://127.0.0.1:3000'),
  lan: z
    .object({
      enabled: z.boolean().default(true),
      bind: z.string().default('0.0.0.0'),
      port: z.number().int().min(1).max(65535).default(8080),
      webDir: z.string().default('apps/web/dist-lan'),
    })
    .default({}),
  mqttLocal: z
    .object({
      port: z.number().int().min(0).max(65535).default(1883),
      wsPort: z.number().int().min(0).max(65535).default(9001),
    })
    .default({}),
  log: z
    .object({
      level: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
    })
    .default({}),
  /** DN_EMULATOR: dev mode against Firebase emulators */
  emulator: z.boolean().default(false),
  /** DN_MOCK_Z2M: use the mock Z2M instead of real Zigbee2MQTT */
  mockZ2m: z.boolean().default(false),
  /** DN_CLOUD_MQTT_TLS: cloud MQTT over TLS (false for dev broker) */
  cloudMqttTls: z.boolean().default(true),
  /** supervisor.manage=false (DN_EXTERNAL_SERVICES=1): Mosquitto/Z2M run elsewhere (compose); the hub only connects */
  supervisor: z
    .object({
      manage: z.boolean().default(true),
      /** broker host when not managed (DN_MQTT_HOST) */
      mqttHost: z.string().default('127.0.0.1'),
    })
    .default({}),
  /** DN_NODE_PATH (alias DN_NODE_EXE): real node binary used to spawn Z2M when the hub is a SEA exe */
  nodePath: z.string().optional(),
  /** DN_TOOLS_DIR: location of pinned Mosquitto/Z2M; resolved by paths helper when unset */
  toolsDir: z.string().optional(),
});
export type HubConfig = z.infer<typeof HubConfig>;
