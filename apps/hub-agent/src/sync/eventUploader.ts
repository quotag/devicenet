import type { HubEvent } from '@devicenet/shared';
import type { EventsRepo } from '../store/events.js';
import type { ConfigStore, EventDoc } from './ConfigStore.js';
import { EVENT_TTL_MS, isPermissionDenied } from './firestoreStore.js';

type Log = { warn(obj: object, msg?: string): void };

const STRING_FIELDS = ['deviceId', 'ruleId', 'sceneId', 'runId', 'result', 'title'] as const;

/** HubEvent (MQTT shape) to EventDoc (Firestore shape; expireAt epoch here, Timestamp in the converter, OQ-4). */
export function toEventDoc(e: HubEvent): EventDoc {
  const { v: _v, seq: _seq, id, hubId, ts, type, ...rest } = e as unknown as Record<string, unknown> & {
    id: string;
    hubId: string;
    ts: number;
    type: string;
  };
  const top: Record<string, string> = {};
  for (const k of STRING_FIELDS) if (typeof rest[k] === 'string') top[k] = rest[k] as string;
  const detail = Object.fromEntries(Object.entries(rest).filter(([k, val]) => !(STRING_FIELDS as readonly string[]).includes(k) && val !== undefined));
  return {
    id,
    hubId,
    ts,
    type,
    ...top,
    ...(Object.keys(detail).length ? { detail } : {}),
    expireAt: ts + EVENT_TTL_MS,
  } as unknown as EventDoc;
}

export interface EventUploaderOptions {
  store: () => ConfigStore | null | undefined;
  repo: EventsRepo;
  log?: Log;
  batch?: number;
}

/** US16: uploads SQLite events to Firestore. setDoc without merge; permission-denied on retry means it already exists (OQ-9). */
export class EventUploader {
  private flushing: Promise<number> | null = null;

  constructor(private readonly o: EventUploaderOptions) {}

  /** hook for HubEvents.setUploader (the event is already persisted in SQLite) */
  readonly enqueue = (_e: HubEvent): void => {
    void this.flush().catch(() => {});
  };

  /** Upload all pending events; returns the number uploaded. Stops at the first transient failure. */
  flush(): Promise<number> {
    this.flushing ??= this.run().finally(() => (this.flushing = null));
    return this.flushing;
  }

  private async run(): Promise<number> {
    const store = this.o.store();
    if (!store || store.signInState !== 'signed-in') return 0;
    let n = 0;
    for (;;) {
      const rows = this.o.repo.pendingUpload(this.o.batch ?? 50);
      if (!rows.length) return n;
      for (const row of rows) {
        try {
          await store.putEvent(toEventDoc(row.event));
        } catch (e) {
          if (!isPermissionDenied(e)) {
            this.o.log?.warn({ id: row.id, err: (e as Error).message }, 'event upload failed; will retry');
            return n;
          }
          // update of an existing event is denied by the rules: treat as already uploaded
        }
        this.o.repo.markUploaded(row.id);
        n++;
      }
    }
  }
}
