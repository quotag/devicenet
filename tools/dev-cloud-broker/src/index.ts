import { createServer, type Server } from 'node:net';
import { createServer as createHttpServer, type Server as HttpServer } from 'node:http';
// aedes is CJS: its named export is not visible to Node's ESM loader (tsx/node), only to bundlers (vitest)
import * as aedesNs from 'aedes';
const createBroker: typeof aedesNs.createBroker =
  (aedesNs as { createBroker?: typeof aedesNs.createBroker }).createBroker ??
  (aedesNs as unknown as { default: { createBroker: typeof aedesNs.createBroker } }).default.createBroker;
import { WebSocketServer, createWebSocketStream } from 'ws';
import { mirrorStatus, type MirrorOptions } from './mirror.js';

export const version = '0.0.1';

export interface DevCloudBrokerOptions {
  tcpPort?: number;
  wsPort?: number;
  webhookUrl?: string;
  token?: string;
  host?: string;
  retryDelayMs?: number;
  log?: (msg: string) => void;
}

export interface DevCloudBroker {
  tcpPort: number;
  wsPort: number;
  close(): Promise<void>;
}

/**
 * aedes broker: tcp + WebSocket (any path). No auth for apps.
 * TODO: optional DEV_BROKER_HUB_AUTH=1 (api /v1/emqx/auth|acl) not implemented in v1.
 */
export async function startDevCloudBroker(opts: DevCloudBrokerOptions = {}): Promise<DevCloudBroker> {
  const host = opts.host ?? '127.0.0.1';
  const aedes = createBroker();
  const mirror: MirrorOptions | undefined = opts.webhookUrl
    ? { webhookUrl: opts.webhookUrl, token: opts.token ?? 'dev-token', retryDelayMs: opts.retryDelayMs, log: opts.log }
    : undefined;
  if (mirror) {
    aedes.on('publish', (packet: { topic: string; payload: Buffer | string }, client: unknown) => {
      if (!client || packet.topic.startsWith('$SYS')) return;
      void mirrorStatus(packet.topic, packet.payload, mirror);
    });
  }

  const tcp: Server = createServer(aedes.handle);
  const http: HttpServer = createHttpServer();
  const wss = new WebSocketServer({ server: http, handleProtocols: (p) => (p.has('mqtt') ? 'mqtt' : p.values().next().value ?? false) });
  wss.on('connection', (ws) => aedes.handle(createWebSocketStream(ws) as never));

  const listen = (s: Server | HttpServer, port: number) =>
    new Promise<number>((resolve, reject) => {
      s.once('error', reject);
      s.listen(port, host, () => resolve((s.address() as { port: number }).port));
    });
  const tcpPort = await listen(tcp, opts.tcpPort ?? 1884);
  const wsPort = await listen(http, opts.wsPort ?? 8084);

  return {
    tcpPort,
    wsPort,
    close: async () => {
      for (const c of wss.clients) c.terminate();
      await new Promise<void>((r) => wss.close(() => r()));
      await new Promise<void>((r) => http.close(() => r()));
      await new Promise<void>((r) => tcp.close(() => r()));
      await new Promise<void>((r) => aedes.close(() => r()));
    },
  };
}
