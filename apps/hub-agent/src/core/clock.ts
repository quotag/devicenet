/** Injectable time + timers so core logic is testable with fake time. */
export interface Clock {
  now(): number;
}

export interface TimerHandle {
  cancel(): void;
}

export interface TimerHost {
  setTimeout(fn: () => void, ms: number): TimerHandle;
  setInterval(fn: () => void, ms: number): TimerHandle;
}

export const realClock: Clock = { now: () => Date.now() };

export const realTimers: TimerHost = {
  setTimeout(fn, ms) {
    const t = setTimeout(fn, ms);
    return { cancel: () => clearTimeout(t) };
  },
  setInterval(fn, ms) {
    const t = setInterval(fn, ms);
    return { cancel: () => clearInterval(t) };
  },
};

/** Manually advanced clock + timers (tests). `advance(ms)` fires due timers in order. */
export class FakeTime implements Clock, TimerHost {
  private t: number;
  private seq = 0;
  private timers = new Map<number, { at: number; fn: () => void; every?: number }>();

  constructor(start = 0) {
    this.t = start;
  }

  now(): number {
    return this.t;
  }

  set(ms: number): void {
    this.t = ms;
  }

  setTimeout(fn: () => void, ms: number): TimerHandle {
    const id = ++this.seq;
    this.timers.set(id, { at: this.t + ms, fn });
    return { cancel: () => void this.timers.delete(id) };
  }

  setInterval(fn: () => void, ms: number): TimerHandle {
    const id = ++this.seq;
    this.timers.set(id, { at: this.t + ms, fn, every: Math.max(1, ms) });
    return { cancel: () => void this.timers.delete(id) };
  }

  pending(): number {
    return this.timers.size;
  }

  advance(ms: number): void {
    const target = this.t + ms;
    for (;;) {
      let nextId = -1;
      let nextAt = Infinity;
      for (const [id, tm] of this.timers) {
        if (tm.at <= target && (tm.at < nextAt || (tm.at === nextAt && id < nextId))) {
          nextId = id;
          nextAt = tm.at;
        }
      }
      if (nextId === -1) break;
      const tm = this.timers.get(nextId)!;
      this.t = Math.max(this.t, tm.at);
      if (tm.every !== undefined) tm.at += tm.every;
      else this.timers.delete(nextId);
      tm.fn();
    }
    this.t = target;
  }
}
