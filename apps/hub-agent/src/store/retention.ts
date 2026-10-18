import { Cron } from 'croner';
import type { Store } from './index.js';

export const HISTORY_RETENTION_MS = 7 * 24 * 3600_000;
export const EVENTS_RETENTION_MS = 30 * 24 * 3600_000;

/** One cleanup pass: history > 7 d, events > 30 d. */
export function runRetention(store: Pick<Store, 'history' | 'events'>, now = Date.now()): { history: number; events: number } {
  return {
    history: store.history.deleteBefore(now - HISTORY_RETENTION_MS),
    events: store.events.deleteBefore(now - EVENTS_RETENTION_MS),
  };
}

/** Hourly job (at minute 0); also runs once at start. Returns stop(). */
export function startRetention(store: Pick<Store, 'history' | 'events'>, onError?: (e: unknown) => void): () => void {
  const run = () => {
    try {
      runRetention(store);
    } catch (e) {
      onError?.(e);
    }
  };
  run();
  const job = new Cron('0 * * * *', { protect: true }, run);
  return () => job.stop();
}
