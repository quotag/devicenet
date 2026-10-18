import type { Clock, TimerHandle, TimerHost } from './clock.js';
import { realClock, realTimers } from './clock.js';

/** Upper bounds (ms) of the latency buckets; one extra overflow bucket follows. */
export const LATENCY_BUCKETS_MS = [50, 100, 200, 500, 1000, 2000, 5000] as const;

export type LatencyKind = 'cmdAck' | 'setState';

export interface LatencySummary {
  count: number;
  p50: number;
  p95: number;
  max: number;
  /** counts per bucket (`LATENCY_BUCKETS_MS.length + 1` entries) */
  buckets: number[];
}

class Histogram {
  private counts = new Array<number>(LATENCY_BUCKETS_MS.length + 1).fill(0);
  private n = 0;
  private maxMs = 0;

  add(ms: number): void {
    const v = Math.max(0, ms);
    let i = LATENCY_BUCKETS_MS.findIndex((b) => v <= b);
    if (i < 0) i = LATENCY_BUCKETS_MS.length;
    this.counts[i]!++;
    this.n++;
    if (v > this.maxMs) this.maxMs = v;
  }

  /** bucket upper bound containing quantile q (overflow bucket reports the observed max) */
  private quantile(q: number): number {
    if (!this.n) return 0;
    const target = Math.ceil(q * this.n);
    let acc = 0;
    for (let i = 0; i < this.counts.length; i++) {
      acc += this.counts[i]!;
      if (acc >= target) return i < LATENCY_BUCKETS_MS.length ? LATENCY_BUCKETS_MS[i]! : this.maxMs;
    }
    return this.maxMs;
  }

  summary(): LatencySummary {
    return { count: this.n, p50: this.quantile(0.5), p95: this.quantile(0.95), max: this.maxMs, buckets: [...this.counts] };
  }
}

/** Latency histograms for NFR checks (cmd sentAt → ack, set → confirming state). Cheap, in-memory. */
export class Metrics {
  private h: Record<LatencyKind, Histogram> = { cmdAck: new Histogram(), setState: new Histogram() };
  private timer?: TimerHandle;

  constructor(private readonly clock: Clock = realClock) {}

  observe(kind: LatencyKind, ms: number): void {
    if (Number.isFinite(ms)) this.h[kind].add(ms);
  }

  /** cmd.sentAt (client clock) → now; skewed/absurd values are clamped to [0, 1 h] to keep the histogram usable */
  observeSince(kind: LatencyKind, startedAt: number): void {
    this.observe(kind, Math.min(this.clock.now() - startedAt, 3_600_000));
  }

  snapshot(): Record<LatencyKind, LatencySummary> {
    return { cmdAck: this.h.cmdAck.summary(), setState: this.h.setState.summary() };
  }

  /** log the snapshot every `everyMs` (default 10 min) */
  startLogging(log: { info(obj: object, msg?: string): void }, timers: TimerHost = realTimers, everyMs = 600_000): void {
    this.stopLogging();
    this.timer = timers.setInterval(() => log.info({ latency: this.snapshot(), rssMb: Math.round(process.memoryUsage().rss / 1048576) }, 'metrics'), everyMs);
  }

  stopLogging(): void {
    this.timer?.cancel();
    this.timer = undefined;
  }
}
