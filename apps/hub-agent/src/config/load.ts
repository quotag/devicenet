import { existsSync, readFileSync } from 'node:fs';
import { parse } from 'yaml';
import { HubConfig } from './schema.js';

const truthy = (v: string) => ['1', 'true', 'yes', 'on'].includes(v.trim().toLowerCase());

/** Apply env overrides on top of the raw (unvalidated) yaml object. */
export function applyEnv(raw: Record<string, unknown>, env: NodeJS.ProcessEnv): Record<string, unknown> {
  const out: Record<string, unknown> = { ...raw };
  if (env.DN_EMULATOR !== undefined) out.emulator = truthy(env.DN_EMULATOR);
  if (env.DN_MOCK_Z2M !== undefined) out.mockZ2m = truthy(env.DN_MOCK_Z2M);
  if (env.DN_CLOUD_MQTT_TLS !== undefined) out.cloudMqttTls = truthy(env.DN_CLOUD_MQTT_TLS);
  if (env.DN_API_BASE_URL) out.apiBaseUrl = env.DN_API_BASE_URL;
  if (env.DN_TOOLS_DIR) out.toolsDir = env.DN_TOOLS_DIR;
  if (env.DN_DATA_DIR) out.dataDir = env.DN_DATA_DIR;
  const nodePath = env.DN_NODE_PATH || env.DN_NODE_EXE;
  if (nodePath) out.nodePath = nodePath;
  if (env.DN_EXTERNAL_SERVICES !== undefined || env.DN_MQTT_HOST) {
    const sup = { ...((raw.supervisor as Record<string, unknown> | undefined) ?? {}) };
    if (env.DN_EXTERNAL_SERVICES !== undefined) sup.manage = !truthy(env.DN_EXTERNAL_SERVICES);
    if (env.DN_MQTT_HOST) sup.mqttHost = env.DN_MQTT_HOST;
    out.supervisor = sup;
  }
  return out;
}

export interface LoadOptions {
  /** path to config.yaml; missing file => defaults */
  file?: string;
  env?: NodeJS.ProcessEnv;
}

export function loadConfig(opts: LoadOptions = {}): HubConfig {
  const env = opts.env ?? process.env;
  let raw: Record<string, unknown> = {};
  if (opts.file && existsSync(opts.file)) {
    const parsed: unknown = parse(readFileSync(opts.file, 'utf8'));
    if (parsed !== null && parsed !== undefined) {
      if (typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error(`config ${opts.file}: expected a mapping`);
      raw = parsed as Record<string, unknown>;
    }
  }
  const res = HubConfig.safeParse(applyEnv(raw, env));
  if (!res.success) {
    const msg = res.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; ');
    throw new Error(`invalid config: ${msg}`);
  }
  return res.data;
}
