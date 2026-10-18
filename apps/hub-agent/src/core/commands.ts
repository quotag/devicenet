import { CMD_ACK_TIMEOUT_MS, CommandEnvelope, CommandId, type CommandAck } from '@devicenet/shared';
import type { Clock, TimerHost } from './clock.js';
import { realClock, realTimers } from './clock.js';
import { defaultHandlers, type CommandContext, type CommandHandler, type CommandResult, type HandlerMap } from './handlers/index.js';
import type { Metrics } from './metrics.js';
import type { Publisher } from './publisher.js';

export interface CommandProcessorOptions {
  ctx: CommandContext;
  publisher: Publisher;
  handlers?: Partial<HandlerMap>;
  clock?: Clock;
  timers?: TimerHost;
  /** dedupe window for cmd.id (QoS1 redelivery, LAN + cloud duplicates) */
  dedupeMs?: number;
  /** ack guard: a handler slower than this → ack `timeout` (must stay < CMD_ACK_TIMEOUT_MS) */
  guardMs?: number;
  maxDedupeEntries?: number;
  metrics?: Pick<Metrics, 'observeSince'>;
  log?: { warn(obj: object, msg?: string): void; debug?(obj: object, msg?: string): void };
}

type AckBody = Omit<CommandAck, 'v' | 'ts' | 'seq'>;

/**
 * cmd handling (FR-H05, data-model §4): received → dedupe → `CommandEnvelope.safeParse`
 * (fail → ack `invalid`) → handler (5 s guard → ack `timeout`) → ack.
 * Commands run in parallel except `pairing.*`, which are serialized by a mutex.
 */
export class CommandProcessor {
  private seen = new Map<string, number>(); // cmd.id -> expiresAt
  private pairingChain: Promise<unknown> = Promise.resolve();
  private readonly handlers: HandlerMap;
  private readonly clock: Clock;
  private readonly timers: TimerHost;
  private readonly dedupeMs: number;
  private readonly guardMs: number;
  private readonly maxEntries: number;

  constructor(private readonly o: CommandProcessorOptions) {
    this.handlers = { ...defaultHandlers, ...o.handlers } as HandlerMap;
    this.clock = o.clock ?? realClock;
    this.timers = o.timers ?? realTimers;
    this.dedupeMs = o.dedupeMs ?? 60_000;
    this.guardMs = o.guardMs ?? CMD_ACK_TIMEOUT_MS - 500;
    this.maxEntries = o.maxDedupeEntries ?? 5000;
  }

  /** true when `id` was already seen within the window (and records it otherwise) */
  private isDuplicate(id: string): boolean {
    const now = this.clock.now();
    for (const [k, exp] of this.seen) {
      if (exp > now) break; // insertion order == expiry order
      this.seen.delete(k);
    }
    const exp = this.seen.get(id);
    if (exp !== undefined && exp > now) return true;
    this.seen.set(id, now + this.dedupeMs);
    while (this.seen.size > this.maxEntries) this.seen.delete(this.seen.keys().next().value as string);
    return false;
  }

  private ack(body: AckBody): CommandAck | null {
    return this.o.publisher.publishHub('ack', body) as CommandAck | null;
  }

  /**
   * Handle one cmd message from any source ("lan" | "cloud" | …). Resolves with the published ack,
   * or null when dropped (duplicate, or no correlatable id).
   */
  async handle(payload: unknown, source = 'unknown'): Promise<CommandAck | null> {
    let body = payload;
    if (Buffer.isBuffer(body) || typeof body === 'string') {
      try {
        body = JSON.parse(body.toString());
      } catch {
        body = undefined;
      }
    }
    const rawId = (body as { id?: unknown } | undefined)?.id;
    const id = CommandId.safeParse(rawId).success ? (rawId as string) : null;
    if (!id) {
      this.o.log?.warn({ source }, 'cmd without valid id dropped');
      return null;
    }
    if (this.isDuplicate(id)) {
      this.o.log?.debug?.({ id, source }, 'duplicate cmd dropped');
      return null;
    }
    const parsed = CommandEnvelope.safeParse(body);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      const message = issue ? `${issue.path.join('.')}: ${issue.message}` : 'invalid';
      return this.ack({ id, ok: false, error: 'invalid', message: message.slice(0, 300) });
    }
    const env = parsed.data;
    const type = env.cmd.type;
    const handler = this.handlers[type] as CommandHandler | undefined;
    if (!handler) return this.ack({ id, ok: false, error: 'invalid', message: `unknown type ${type}` });

    const run = () => this.guard(() => handler(env.cmd as never, this.o.ctx, env));
    let result: CommandResult;
    if (type.startsWith('pairing.')) {
      const p = this.pairingChain.then(run);
      this.pairingChain = p.catch(() => undefined);
      result = await p;
    } else {
      result = await run();
    }
    const ack = this.ack({ id, ...result });
    if (ack && typeof env.sentAt === 'number') this.o.metrics?.observeSince('cmdAck', env.sentAt);
    return ack;
  }

  private guard(fn: () => Promise<CommandResult>): Promise<CommandResult> {
    return new Promise<CommandResult>((resolve) => {
      let done = false;
      const timer = this.timers.setTimeout(() => {
        if (done) return;
        done = true;
        resolve({ ok: false, error: 'timeout', message: 'handler exceeded ack guard' });
      }, this.guardMs);
      let p: Promise<CommandResult>;
      try {
        p = fn();
      } catch (e) {
        p = Promise.reject(e);
      }
      p.then(
        (r) => {
          if (done) return;
          done = true;
          timer.cancel();
          resolve(r);
        },
        (e: unknown) => {
          if (done) return;
          done = true;
          timer.cancel();
          resolve({ ok: false, error: 'internal', message: String((e as Error)?.message ?? e).slice(0, 300) });
        },
      );
    });
  }
}
