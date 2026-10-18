/**
 * Per-topic sequence gate (docs/realtime-and-events.md §2.3, research R4).
 *
 * Accepts a message when:
 *  - the topic has no history yet, or
 *  - `seq > lastSeq` (normal monotonic progress), or
 *  - `ts > lastTs + REBOOT_WINDOW_MS` (hub restarted and reset `seq` to 0).
 * Everything else (QoS1 duplicate, out-of-order, identical retained replay) is dropped.
 *
 * Keyed by the full topic string. Not cleared on reconnect; only `reset()` on sign-out.
 */
export const REBOOT_WINDOW_MS = 60_000;

interface Last {
  seq: number;
  ts: number;
}

export class SeqGate {
  private readonly last = new Map<string, Last>();

  accept(topic: string, seq: number, ts: number): boolean {
    const prev = this.last.get(topic);
    if (!prev || seq > prev.seq || ts > prev.ts + REBOOT_WINDOW_MS) {
      this.last.set(topic, { seq, ts });
      return true;
    }
    return false;
  }

  /** Forget one topic (e.g. retained state cleared because the device was removed). */
  forget(topic: string): void {
    this.last.delete(topic);
  }

  reset(): void {
    this.last.clear();
  }
}
