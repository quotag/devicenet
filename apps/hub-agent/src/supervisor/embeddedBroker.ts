import { createServer as createHttpServer, type Server as HttpServer } from 'node:http';
import { createServer, type Server } from 'node:net';
// aedes is CJS: its named export is not visible to Node's ESM loader (tsx/node), only to bundlers (vitest)
import * as aedesNs from 'aedes';
const createBroker: typeof aedesNs.createBroker =
  (aedesNs as { createBroker?: typeof aedesNs.createBroker }).createBroker ??
  (aedesNs as unknown as { default: { createBroker: typeof aedesNs.createBroker } }).default.createBroker;
import { WebSocketServer, createWebSocketStream } from 'ws';

/** Same rules as the generated Mosquitto anon ACL (FR-H11). */
const ANON_PUBLISH = [/^t\/[^/]+\/h\/[^/]+\/d\/[^/]+\/set$/, /^t\/[^/]+\/h\/[^/]+\/cmd$/];

/** May an anonymous (WebSocket) client subscribe to this filter? read `t/#` only. */
export function anonCanRead(filter: string): boolean {
  return filter.startsWith('t/') || filter === 't';
}
export function anonCanWrite(topic: string): boolean {
  return ANON_PUBLISH.some((r) => r.test(topic));
}
/** Local TCP: user `z2m` is confined to `zigbee2mqtt/#`; everyone else on the loopback listener is `hub` (full). */
export function localCanAccess(username: string | undefined, topic: string): boolean {
  if (username === 'z2m') return topic === 'zigbee2mqtt' || topic.startsWith('zigbee2mqtt/') || topic === 'zigbee2mqtt/#';
  return true;
}

export interface EmbeddedBrokerOptions {
  /** 0 = ephemeral */
  port: number;
  wsPort: number;
  host?: string;
  wsHost?: string;
}

export interface EmbeddedBroker {
  port: number;
  wsPort: number;
  aedes: ReturnType<typeof createBroker>;
  close(): Promise<void>;
}

/** aedes fallback for mock mode without Mosquitto: tcp (loopback) + ws (anonymous, ACL-restricted). */
export async function startEmbeddedBroker(opts: EmbeddedBrokerOptions): Promise<EmbeddedBroker> {
  const aedes = createBroker();
  const wsClients = new WeakSet<object>();

  aedes.authorizePublish = (client, packet, cb) => {
    if (client && wsClients.has(client)) {
      return anonCanWrite(packet.topic) ? cb(null) : cb(new Error('not authorized'));
    }
    const user = (client as unknown as { dnUser?: string } | null)?.dnUser;
    return localCanAccess(user, packet.topic) ? cb(null) : cb(new Error('not authorized'));
  };
  aedes.authorizeSubscribe = (client, sub, cb) => {
    if (wsClients.has(client)) return cb(null, anonCanRead(sub.topic) ? sub : null);
    const user = (client as unknown as { dnUser?: string }).dnUser;
    if (user === 'z2m') {
      const t = sub.topic;
      return cb(null, t === 'zigbee2mqtt/#' || t.startsWith('zigbee2mqtt/') ? sub : null);
    }
    return cb(null, sub);
  };
  aedes.authenticate = (client, username, _password, cb) => {
    (client as unknown as { dnUser?: string }).dnUser = username;
    cb(null, true);
  };

  const tcp: Server = createServer((sock) => {
    aedes.handle(sock);
  });
  await new Promise<void>((res, rej) => {
    tcp.once('error', rej);
    tcp.listen(opts.port, opts.host ?? '127.0.0.1', res);
  });

  const http: HttpServer = createHttpServer();
  const wss = new WebSocketServer({ server: http });
  wss.on('connection', (socket) => {
    const client = aedes.handle(createWebSocketStream(socket) as never);
    wsClients.add(client);
  });
  await new Promise<void>((res, rej) => {
    http.once('error', rej);
    http.listen(opts.wsPort, opts.wsHost ?? '0.0.0.0', res);
  });

  const addrPort = (s: Server | HttpServer) => (s.address() as { port: number }).port;
  return {
    port: addrPort(tcp),
    wsPort: addrPort(http),
    aedes,
    close: async () => {
      wss.clients.forEach((c) => c.terminate());
      await new Promise<void>((res) => wss.close(() => res()));
      http.closeAllConnections?.();
      await new Promise<void>((res) => http.close(() => res()));
      tcp.close();
      await new Promise<void>((res) => aedes.close(() => res()));
    },
  };
}
