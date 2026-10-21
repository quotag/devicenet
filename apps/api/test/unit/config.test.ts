import { describe, it, expect } from 'vitest';
import { loadConfig } from '../../src/config.js';

const validProdEnv: NodeJS.ProcessEnv = {
  NODE_ENV: 'production',
  GCLOUD_PROJECT: 'my-gcp-project',
  HOSTING_ORIGIN: 'https://devicenet.web.app,https://devicenet.firebaseapp.com',
  DN_API_BASE_URL: 'https://api.devicenet.example.com',
  DN_MQTT_HOST: 'mqtt.devicenet.example.com',
  DN_MQTT_PORT: '8883',
  DN_MQTT_WSS_PORT: '8084',
  EMQX_SHARED_TOKEN: '12345678901234567890123456789012', // 32 chars
  FIREBASE_WEB_API_KEY: 'AIzaSyA_fake_prod_api_key_123456789',
};

describe('loadConfig', () => {
  it('loads valid production configuration', () => {
    const cfg = loadConfig(validProdEnv);
    expect(cfg.isEmulator).toBe(false);
    expect(cfg.projectId).toBe('my-gcp-project');
    expect(cfg.hostingOrigins).toEqual([
      'https://devicenet.web.app',
      'https://devicenet.firebaseapp.com',
    ]);
    expect(cfg.apiBaseUrl).toBe('https://api.devicenet.example.com');
    expect(cfg.mqttHost).toBe('mqtt.devicenet.example.com');
    expect(cfg.mqttPort).toBe(8883);
    expect(cfg.mqttWssPort).toBe(8084);
    expect(cfg.emqxSharedToken).toBe('12345678901234567890123456789012');
    expect(cfg.firebaseWebApiKey).toBe('AIzaSyA_fake_prod_api_key_123456789');
    expect(cfg.trustProxy).toBe(true);
  });

  it('rejects production mode when FIRESTORE_EMULATOR_HOST is set', () => {
    expect(() =>
      loadConfig({
        ...validProdEnv,
        FIRESTORE_EMULATOR_HOST: '127.0.0.1:8085',
      }),
    ).toThrow(/emulator hosts/i);
  });

  it('rejects production mode when FIREBASE_AUTH_EMULATOR_HOST is set', () => {
    expect(() =>
      loadConfig({
        ...validProdEnv,
        FIREBASE_AUTH_EMULATOR_HOST: '127.0.0.1:9099',
      }),
    ).toThrow(/emulator hosts/i);
  });

  it('provides dev defaults when FIRESTORE_EMULATOR_HOST is set in dev mode', () => {
    const cfg = loadConfig({
      NODE_ENV: 'development',
      FIRESTORE_EMULATOR_HOST: '127.0.0.1:8085',
    });
    expect(cfg.isEmulator).toBe(true);
    expect(cfg.projectId).toBe('demo-devicenet');
    expect(cfg.emqxSharedToken).toBe('dev-token');
    expect(cfg.mqttHost).toBe('127.0.0.1');
    expect(cfg.hostingOrigins).toEqual(['http://localhost:5173']);
    expect(cfg.trustProxy).toBe(false);
  });

  it('throws when GCLOUD_PROJECT / FIREBASE_PROJECT_ID is missing in prod', () => {
    const env = { ...validProdEnv };
    delete env.GCLOUD_PROJECT;
    delete env.GOOGLE_CLOUD_PROJECT;
    delete env.FIREBASE_PROJECT_ID;
    expect(() => loadConfig(env)).toThrow(/GCLOUD_PROJECT/);
  });

  it('throws when HOSTING_ORIGIN is missing in prod', () => {
    const env = { ...validProdEnv };
    delete env.HOSTING_ORIGIN;
    expect(() => loadConfig(env)).toThrow(/HOSTING_ORIGIN/);
  });

  it('throws when HOSTING_ORIGIN is not https in prod', () => {
    const env = { ...validProdEnv, HOSTING_ORIGIN: 'http://insecure.example.com' };
    expect(() => loadConfig(env)).toThrow(/HOSTING_ORIGIN/);
  });

  it('throws when DN_API_BASE_URL is missing in prod', () => {
    const env = { ...validProdEnv };
    delete env.DN_API_BASE_URL;
    expect(() => loadConfig(env)).toThrow(/DN_API_BASE_URL/);
  });

  it('throws when DN_API_BASE_URL is not https in prod', () => {
    const env = { ...validProdEnv, DN_API_BASE_URL: 'http://api.devicenet.example.com' };
    expect(() => loadConfig(env)).toThrow(/DN_API_BASE_URL/);
  });

  it('throws when DN_MQTT_HOST is missing in prod', () => {
    const env = { ...validProdEnv };
    delete env.DN_MQTT_HOST;
    expect(() => loadConfig(env)).toThrow(/DN_MQTT_HOST/);
  });

  it('throws when DN_MQTT_PORT is missing or invalid in prod', () => {
    const env = { ...validProdEnv };
    delete env.DN_MQTT_PORT;
    expect(() => loadConfig(env)).toThrow(/DN_MQTT_PORT/);

    expect(() => loadConfig({ ...validProdEnv, DN_MQTT_PORT: 'invalid' })).toThrow(/DN_MQTT_PORT/);
    expect(() => loadConfig({ ...validProdEnv, DN_MQTT_PORT: '999999' })).toThrow(/DN_MQTT_PORT/);
  });

  it('throws when DN_MQTT_WSS_PORT is missing or invalid in prod', () => {
    const env = { ...validProdEnv };
    delete env.DN_MQTT_WSS_PORT;
    expect(() => loadConfig(env)).toThrow(/DN_MQTT_WSS_PORT/);

    expect(() => loadConfig({ ...validProdEnv, DN_MQTT_WSS_PORT: 'abc' })).toThrow(/DN_MQTT_WSS_PORT/);
  });

  it('throws when EMQX_SHARED_TOKEN is missing or too short in prod', () => {
    const env = { ...validProdEnv };
    delete env.EMQX_SHARED_TOKEN;
    expect(() => loadConfig(env)).toThrow(/EMQX_SHARED_TOKEN/);

    expect(() => loadConfig({ ...validProdEnv, EMQX_SHARED_TOKEN: 'too-short-token' })).toThrow(/EMQX_SHARED_TOKEN/);
  });

  it('throws when FIREBASE_WEB_API_KEY is missing in prod', () => {
    const env = { ...validProdEnv };
    delete env.FIREBASE_WEB_API_KEY;
    expect(() => loadConfig(env)).toThrow(/FIREBASE_WEB_API_KEY/);
  });
});
