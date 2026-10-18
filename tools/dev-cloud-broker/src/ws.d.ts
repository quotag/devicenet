// Minimal typings (avoids adding @types/ws).
declare module 'ws' {
  export class WebSocketServer {
    constructor(opts: { server: unknown; handleProtocols?: (p: Set<string>) => string | false });
    clients: Set<{ terminate(): void }>;
    on(ev: 'connection', cb: (ws: unknown) => void): void;
    close(cb: () => void): void;
  }
  export function createWebSocketStream(ws: unknown): NodeJS.ReadWriteStream;
}
