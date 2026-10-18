/**
 * Hub clock offset estimator (docs/realtime-and-events.md §2.4, research R5).
 *
 * offset = hubTs − localNow. Live (non-retained) `status` heartbeats are the trusted samples;
 * the median of the last MAX_SAMPLES is used. A retained `status` may be up to one heartbeat
 * old, so it only provides a provisional value until the first live sample arrives.
 * One instance per hub.
 */
export const MAX_SAMPLES = 5;

function median(xs: readonly number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

export class ClockOffset {
  private live: number[] = [];
  private provisional: number | null = null;

  /**
   * @param hubTs    `ts` of a hub payload (epoch ms, hub clock). Non-positive values (LWT `ts: 0`) are ignored.
   * @param localNow `Date.now()` at receipt.
   * @param retained MQTT retain flag of the message.
   */
  addSample(hubTs: number, localNow: number, retained: boolean): void {
    if (!Number.isFinite(hubTs) || hubTs <= 0 || !Number.isFinite(localNow)) return;
    const sample = hubTs - localNow;
    if (retained) {
      if (this.live.length === 0) this.provisional = sample;
      return;
    }
    this.live.push(sample);
    if (this.live.length > MAX_SAMPLES) this.live.shift();
  }

  /** Current offset in ms (0 when no sample yet). */
  get offset(): number {
    if (this.live.length) return median(this.live);
    return this.provisional ?? 0;
  }

  /** At least one sample (live or provisional) seen. */
  get hasSample(): boolean {
    return this.live.length > 0 || this.provisional !== null;
  }

  /** Offset is based on live samples, not only a retained one. */
  get isLive(): boolean {
    return this.live.length > 0;
  }

  /** Hub-clock "now": `localNow + offset`. */
  now(localNow: number = Date.now()): number {
    return localNow + this.offset;
  }

  reset(): void {
    this.live = [];
    this.provisional = null;
  }
}
