// Minimal typings for `ws` (no @types/ws dependency in this package).
declare module 'ws' {
  import type { Server as HttpServer } from 'node:http';
  import type { Duplex } from 'node:stream';
  export class WebSocketServer {
    constructor(opts: { server: HttpServer });
    clients: Set<{ terminate(): void }>;
    on(event: 'connection', cb: (socket: unknown) => void): this;
    close(cb?: () => void): void;
  }
  export function createWebSocketStream(socket: unknown): Duplex;
}
