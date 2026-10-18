/**
 * In-process MQTT broker for transport integration tests (research R13).
 * aedes + `net` server on port 0 (or a fixed port for restart tests).
 */
import { createServer, type Server, type Socket } from "node:net";
import type { AddressInfo } from "node:net";
import { Aedes, type AedesOptions } from "aedes";

export interface TestBroker {
  broker: Aedes;
  port: number;
  url: string;
  /** Stop the broker and close every client socket. */
  stop(): Promise<void>;
}

export async function startBroker(opts: AedesOptions & { port?: number } = {}): Promise<TestBroker> {
  const { port: wanted = 0, ...aedesOpts } = opts;
  const broker = await Aedes.createBroker(aedesOpts);
  const sockets = new Set<Socket>();
  const server: Server = createServer((s) => {
    sockets.add(s);
    s.on("close", () => sockets.delete(s));
    broker.handle(s);
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(wanted, "127.0.0.1", () => resolve());
  });
  const port = (server.address() as AddressInfo).port;
  let stopped = false;
  return {
    broker,
    port,
    url: `mqtt://127.0.0.1:${port}`,
    async stop() {
      if (stopped) return;
      stopped = true;
      for (const s of sockets) s.destroy();
      await new Promise<void>((r) => broker.close(() => r()));
      await new Promise<void>((r) => server.close(() => r()));
    },
  };
}
