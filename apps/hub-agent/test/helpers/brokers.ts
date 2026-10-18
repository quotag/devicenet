import { createServer, type AddressInfo, type Server } from 'node:net';
import { createServer as createHttpServer, type Server as HttpServer } from 'node:http';
import { createBroker } from 'aedes';
import mqtt, { type IClientOptions, type MqttClient } from 'mqtt';
import { WebSocketServer, createWebSocketStream } from 'ws';

export interface TestBroker {
  /** mqtt://127.0.0.1:<port> */
  url: string;
  port: number;
  /** ws://127.0.0.1:<wsPort> (only when `ws: true`) */
  wsUrl?: string;
  wsPort?: number;
  aedes: ReturnType<typeof createBroker>;
  close(): Promise<void>;
}

/** Start an aedes broker on an ephemeral TCP port (and optionally an ephemeral WebSocket port). */
export async function startBroker(opts: { ws?: boolean } = {}): Promise<TestBroker> {
  const aedes = createBroker();
  const tcp: Server = createServer((sock) => aedes.handle(sock));
  await new Promise<void>((res) => tcp.listen(0, '127.0.0.1', res));
  const port = (tcp.address() as AddressInfo).port;

  let http: HttpServer | undefined;
  let wss: WebSocketServer | undefined;
  let wsPort: number | undefined;
  if (opts.ws) {
    http = createHttpServer();
    wss = new WebSocketServer({ server: http });
    wss.on('connection', (socket) => aedes.handle(createWebSocketStream(socket) as never));
    await new Promise<void>((res) => http!.listen(0, '127.0.0.1', res));
    wsPort = (http.address() as AddressInfo).port;
  }

  return {
    url: `mqtt://127.0.0.1:${port}`,
    port,
    wsUrl: wsPort ? `ws://127.0.0.1:${wsPort}` : undefined,
    wsPort,
    aedes,
    async close() {
      wss?.clients.forEach((c) => c.terminate());
      await new Promise<void>((res) => (wss ? wss.close(() => res()) : res()));
      await new Promise<void>((res) => (http ? http.close(() => res()) : res()));
      tcp.closeAllConnections?.();
      await new Promise<void>((res) => tcp.close(() => res()));
      await new Promise<void>((res) => aedes.close(() => res()));
    },
  };
}

export interface Received {
  topic: string;
  payload: Buffer;
  /** parsed JSON when the payload is JSON, else undefined */
  json?: unknown;
  retain: boolean;
  qos: number;
}

export interface TestClient {
  client: MqttClient;
  messages: Received[];
  subscribe(topic: string | string[], qos?: 0 | 1 | 2): Promise<void>;
  publish(topic: string, payload: unknown, opts?: { qos?: 0 | 1 | 2; retain?: boolean }): Promise<void>;
  /** resolve with the first (already received or future) message on `topic` (MQTT wildcards ok) matching `predicate` */
  waitFor(topic: string, predicate?: (m: Received) => boolean, ms?: number): Promise<Received>;
  close(): Promise<void>;
}

function topicMatches(filter: string, topic: string): boolean {
  const f = filter.split('/');
  const t = topic.split('/');
  for (let i = 0; i < f.length; i++) {
    if (f[i] === '#') return true;
    if (i >= t.length) return false;
    if (f[i] !== '+' && f[i] !== t[i]) return false;
  }
  return f.length === t.length;
}

export async function connectClient(url: string, opts: IClientOptions = {}): Promise<TestClient> {
  const client = await mqtt.connectAsync(url, { reconnectPeriod: 0, ...opts });
  const messages: Received[] = [];
  const waiters = new Set<() => void>();
  client.on('message', (topic, payload, packet) => {
    let json: unknown;
    try {
      json = JSON.parse(payload.toString('utf8'));
    } catch {
      json = undefined;
    }
    messages.push({ topic, payload, json, retain: packet.retain, qos: packet.qos });
    for (const w of [...waiters]) w();
  });

  return {
    client,
    messages,
    async subscribe(topic, qos = 1) {
      await client.subscribeAsync(topic, { qos });
    },
    async publish(topic, payload, o = {}) {
      const body = typeof payload === 'string' || Buffer.isBuffer(payload) ? payload : JSON.stringify(payload);
      await client.publishAsync(topic, body, { qos: o.qos ?? 1, retain: o.retain ?? false });
    },
    waitFor(topic, predicate = () => true, ms = 2000) {
      return new Promise<Received>((resolve, reject) => {
        const check = (): boolean => {
          const m = messages.find((x) => topicMatches(topic, x.topic) && predicate(x));
          if (m) {
            cleanup();
            resolve(m);
            return true;
          }
          return false;
        };
        const timer = setTimeout(() => {
          cleanup();
          reject(new Error(`waitFor(${topic}) timed out after ${ms}ms; got ${messages.map((x) => x.topic).join(', ') || 'nothing'}`));
        }, ms);
        const cleanup = () => {
          clearTimeout(timer);
          waiters.delete(check);
        };
        if (!check()) waiters.add(check);
      });
    },
    async close() {
      await client.endAsync(true);
    },
  };
}
