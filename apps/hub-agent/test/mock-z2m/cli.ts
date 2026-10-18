import { MockZ2m } from './index.js';

// Usage: tsx test/mock-z2m/cli.ts [mqtt://127.0.0.1:1883]
const url = process.argv[2] ?? process.env.DN_LOCAL_MQTT_URL ?? 'mqtt://127.0.0.1:1883';
const mock = new MockZ2m({ url, latencyMs: Number(process.env.DN_MOCK_Z2M_LATENCY_MS ?? 50) });
await mock.start();
console.log(`[mock-z2m] connected to ${url}`);
const stop = async () => {
  await mock.stop();
  process.exit(0);
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
