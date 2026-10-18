import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer, type Server } from 'node:http';
import mqtt from 'mqtt';
import { startDevCloudBroker, type DevCloudBroker } from '../src/index.js';

interface Hit { token: unknown; body: { topic: string; payload: string; publish_received_at: number } }
const hits: Hit[] = [];
let stub: Server;
let broker: DevCloudBroker;

const until = async (fn: () => boolean, ms = 3000) => {
  const t = Date.now();
  while (!fn()) {
    if (Date.now() - t > ms) throw new Error('timeout');
    await new Promise((r) => setTimeout(r, 20));
  }
};

beforeAll(async () => {
  stub = createServer((req, res) => {
    let b = '';
    req.on('data', (c) => (b += c));
    req.on('end', () => {
      hits.push({ token: req.headers['x-emqx-token'], body: JSON.parse(b) });
      res.statusCode = 204;
      res.end();
    });
  });
  await new Promise<void>((r) => stub.listen(0, '127.0.0.1', r));
  const port = (stub.address() as { port: number }).port;
  broker = await startDevCloudBroker({ tcpPort: 0, wsPort: 0, webhookUrl: `http://127.0.0.1:${port}/v1/emqx/webhook`, token: 'tok' });
});
afterAll(async () => {
  await broker.close();
  stub.close();
});

describe('dev cloud broker', () => {
  it('mirrors status publishes (with token), skips other topics and empty retained clears', async () => {
    const c = await mqtt.connectAsync(`mqtt://127.0.0.1:${broker.tcpPort}`);
    await c.publishAsync('t/tenant_a/h/hub_a/state', 'x');
    await c.publishAsync('t/tenant_a/h/hub_a/events', '{}');
    await c.publishAsync('t/tenant_a/h/hub_a/status', '', { retain: true });
    await c.publishAsync('t/tenant_a/h/hub_a/status', '{"online":true}', { retain: true });
    await until(() => hits.length >= 1);
    await new Promise((r) => setTimeout(r, 200));
    expect(hits).toHaveLength(1);
    expect(hits[0]!.token).toBe('tok');
    expect(hits[0]!.body.topic).toBe('t/tenant_a/h/hub_a/status');
    expect(hits[0]!.body.payload).toBe('{"online":true}');
    expect(typeof hits[0]!.body.publish_received_at).toBe('number');
    await c.endAsync();
  });
  it.each(['/mqtt', '/'])('accepts websocket clients on path %s', async (path) => {
    const c = await mqtt.connectAsync(`ws://127.0.0.1:${broker.wsPort}${path}`);
    expect(c.connected).toBe(true);
    await c.endAsync();
  });

  it('ws publish is mirrored too', async () => {
    const n = hits.length;
    const c = await mqtt.connectAsync(`ws://127.0.0.1:${broker.wsPort}/mqtt`);
    await c.publishAsync('t/tenant_a/h/hub_b/status', '{"online":false}');
    await until(() => hits.length > n);
    await c.endAsync();
  });
});
