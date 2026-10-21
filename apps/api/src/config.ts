import { z } from 'zod';

export interface ApiConfig {
  nodeEnv: string;
  isEmulator: boolean;
  port: number;
  host: string;
  projectId: string;
  hostingOrigins: string[];
  apiBaseUrl: string;
  mqttHost: string;
  mqttPort: number;
  mqttWssPort: number;
  emqxSharedToken: string;
  firebaseWebApiKey: string;
  emqxAdminUrl?: string;
  emqxAdminKey?: string;
  emqxAdminSecret?: string;
  trustProxy?: boolean | string;
}

let activeConfig: ApiConfig | null = null;

export function setConfig(cfg: ApiConfig | null): void {
  activeConfig = cfg;
}

export function getConfig(): ApiConfig {
  if (!activeConfig) {
    activeConfig = loadConfig();
  }
  return activeConfig;
}

function parseOrigins(val: string): string[] {
  return val
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

function isHttpsUrl(u: string): boolean {
  try {
    const parsed = new URL(u);
    return parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ApiConfig {
  const nodeEnv = env.NODE_ENV ?? 'development';
  const hasFirestoreEmulator = Boolean(env.FIRESTORE_EMULATOR_HOST && env.FIRESTORE_EMULATOR_HOST.trim());
  const hasAuthEmulator = Boolean(env.FIREBASE_AUTH_EMULATOR_HOST && env.FIREBASE_AUTH_EMULATOR_HOST.trim());

  if (nodeEnv === 'production' && (hasFirestoreEmulator || hasAuthEmulator)) {
    throw new Error('Production mode cannot be run with emulator hosts (FIRESTORE_EMULATOR_HOST or FIREBASE_AUTH_EMULATOR_HOST)');
  }

  const isEmulator = hasFirestoreEmulator || env.DN_EMULATOR === '1';

  // If in emulator mode: default dev values
  if (isEmulator) {
    const rawOrigins = env.HOSTING_ORIGIN ? parseOrigins(env.HOSTING_ORIGIN) : ['http://localhost:5173'];
    const cfg: ApiConfig = {
      nodeEnv,
      isEmulator: true,
      port: Number(env.PORT || 3000),
      host: env.HOST || '0.0.0.0',
      projectId: env.GCLOUD_PROJECT || env.GOOGLE_CLOUD_PROJECT || env.FIREBASE_PROJECT_ID || 'demo-devicenet',
      hostingOrigins: rawOrigins,
      apiBaseUrl: env.DN_API_BASE_URL || 'http://127.0.0.1:3000',
      mqttHost: env.DN_MQTT_HOST || '127.0.0.1',
      mqttPort: Number(env.DN_MQTT_PORT || 1884),
      mqttWssPort: Number(env.DN_MQTT_WSS_PORT || 8084),
      emqxSharedToken: env.EMQX_SHARED_TOKEN || 'dev-token',
      firebaseWebApiKey: env.FIREBASE_WEB_API_KEY || 'fake-api-key',
      emqxAdminUrl: env.EMQX_ADMIN_URL,
      emqxAdminKey: env.EMQX_ADMIN_KEY,
      emqxAdminSecret: env.EMQX_ADMIN_SECRET,
      trustProxy: env.TRUST_PROXY === 'true' || env.TRUST_PROXY === '1' ? true : false,
    };
    return cfg;
  }

  // If running vitest without emulator and without explicit prod env vars, allow dev fallback for tests
  if (nodeEnv === 'test' && !env.DN_PROD_CONFIG_VALIDATION) {
    const rawOrigins = env.HOSTING_ORIGIN ? parseOrigins(env.HOSTING_ORIGIN) : ['http://localhost:5173'];
    return {
      nodeEnv,
      isEmulator: false,
      port: Number(env.PORT || 3000),
      host: env.HOST || '0.0.0.0',
      projectId: env.GCLOUD_PROJECT || env.GOOGLE_CLOUD_PROJECT || env.FIREBASE_PROJECT_ID || 'demo-devicenet',
      hostingOrigins: rawOrigins,
      apiBaseUrl: env.DN_API_BASE_URL || 'http://127.0.0.1:3000',
      mqttHost: env.DN_MQTT_HOST || '127.0.0.1',
      mqttPort: Number(env.DN_MQTT_PORT || 1884),
      mqttWssPort: Number(env.DN_MQTT_WSS_PORT || 8084),
      emqxSharedToken: env.EMQX_SHARED_TOKEN || 'dev-token',
      firebaseWebApiKey: env.FIREBASE_WEB_API_KEY || 'fake-api-key',
      emqxAdminUrl: env.EMQX_ADMIN_URL,
      emqxAdminKey: env.EMQX_ADMIN_KEY,
      emqxAdminSecret: env.EMQX_ADMIN_SECRET,
      trustProxy: false,
    };
  }

  // Non-emulator (Production / Cloud mode) validation:
  const proj = env.GCLOUD_PROJECT || env.GOOGLE_CLOUD_PROJECT || env.FIREBASE_PROJECT_ID;
  if (!proj || !proj.trim()) {
    throw new Error('Missing required environment variable: GCLOUD_PROJECT (or GOOGLE_CLOUD_PROJECT / FIREBASE_PROJECT_ID)');
  }

  if (!env.HOSTING_ORIGIN || !env.HOSTING_ORIGIN.trim()) {
    throw new Error('Missing required environment variable: HOSTING_ORIGIN');
  }
  const origins = parseOrigins(env.HOSTING_ORIGIN);
  if (origins.length === 0 || !origins.every(isHttpsUrl)) {
    throw new Error('Invalid HOSTING_ORIGIN: all origins must be valid https URLs');
  }

  if (!env.DN_API_BASE_URL || !env.DN_API_BASE_URL.trim()) {
    throw new Error('Missing required environment variable: DN_API_BASE_URL');
  }
  if (!isHttpsUrl(env.DN_API_BASE_URL)) {
    throw new Error('Invalid DN_API_BASE_URL: must be a valid https URL');
  }

  if (!env.DN_MQTT_HOST || !env.DN_MQTT_HOST.trim()) {
    throw new Error('Missing required environment variable: DN_MQTT_HOST');
  }

  if (!env.DN_MQTT_PORT || !env.DN_MQTT_PORT.trim()) {
    throw new Error('Missing required environment variable: DN_MQTT_PORT');
  }
  const portNum = Number(env.DN_MQTT_PORT);
  if (!Number.isInteger(portNum) || portNum <= 0 || portNum > 65535) {
    throw new Error('Invalid DN_MQTT_PORT: must be a valid port number between 1 and 65535');
  }

  if (!env.DN_MQTT_WSS_PORT || !env.DN_MQTT_WSS_PORT.trim()) {
    throw new Error('Missing required environment variable: DN_MQTT_WSS_PORT');
  }
  const wssPortNum = Number(env.DN_MQTT_WSS_PORT);
  if (!Number.isInteger(wssPortNum) || wssPortNum <= 0 || wssPortNum > 65535) {
    throw new Error('Invalid DN_MQTT_WSS_PORT: must be a valid port number between 1 and 65535');
  }

  if (!env.EMQX_SHARED_TOKEN || !env.EMQX_SHARED_TOKEN.trim()) {
    throw new Error('Missing required environment variable: EMQX_SHARED_TOKEN');
  }
  if (env.EMQX_SHARED_TOKEN.length < 32) {
    throw new Error('Invalid EMQX_SHARED_TOKEN: must be at least 32 characters');
  }

  if (!env.FIREBASE_WEB_API_KEY || !env.FIREBASE_WEB_API_KEY.trim()) {
    throw new Error('Missing required environment variable: FIREBASE_WEB_API_KEY');
  }

  return {
    nodeEnv,
    isEmulator: false,
    port: Number(env.PORT || 8080),
    host: env.HOST || '0.0.0.0',
    projectId: proj,
    hostingOrigins: origins,
    apiBaseUrl: env.DN_API_BASE_URL,
    mqttHost: env.DN_MQTT_HOST,
    mqttPort: portNum,
    mqttWssPort: wssPortNum,
    emqxSharedToken: env.EMQX_SHARED_TOKEN,
    firebaseWebApiKey: env.FIREBASE_WEB_API_KEY,
    emqxAdminUrl: env.EMQX_ADMIN_URL,
    emqxAdminKey: env.EMQX_ADMIN_KEY,
    emqxAdminSecret: env.EMQX_ADMIN_SECRET,
    trustProxy: env.TRUST_PROXY === 'false' ? false : true, // default true in prod Cloud Run
  };
}
