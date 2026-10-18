import { topics, type HubEvent } from '@devicenet/shared';
import type { EventsRepo } from '../store/events.js';
import { newId } from './ids.js';
import type { Publisher } from './publisher.js';

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

/** Event body as callers provide it: the type-specific fields (envelope, id, hubId are added here). */
export type HubEventBody = DistributiveOmit<HubEvent, 'v' | 'ts' | 'seq' | 'id' | 'hubId'>;

export type EventUploader = (e: HubEvent) => void;

export interface HubEventsOptions {
  publisher: Publisher;
  repo?: EventsRepo;
  uploader?: EventUploader;
  onError?: (err: unknown) => void;
}

/**
 * Builds `HubEvent` (`evt_` id, hubId, envelope), stores it in SQLite `events`,
 * publishes it (QoS0) and hands it to the Firestore uploader hook (B09/B17).
 * Unclaimed hub (no hubId) → dropped (a HubEvent requires hubId).
 */
export class HubEvents {
  private readonly publisher: Publisher;
  private readonly repo?: EventsRepo;
  private uploader?: EventUploader;
  private listeners = new Set<(e: HubEvent) => void>();
  private readonly onError: (err: unknown) => void;

  constructor(opts: HubEventsOptions) {
    this.publisher = opts.publisher;
    this.repo = opts.repo;
    this.uploader = opts.uploader;
    this.onError = opts.onError ?? (() => {});
  }

  setUploader(fn: EventUploader | undefined): void {
    this.uploader = fn;
  }

  /** local subscribers (engine, LAN, tests) */
  on(cb: (e: HubEvent) => void): () => void {
    this.listeners.add(cb);
    return () => void this.listeners.delete(cb);
  }

  emit(body: HubEventBody): HubEvent | null {
    const id = this.publisher.getIdentity();
    if (!id) return null;
    const event = this.publisher.stamp({ id: newId('evt'), hubId: id.hubId, ...body }) as unknown as HubEvent;
    try {
      this.repo?.insert(event);
    } catch (e) {
      this.onError(e);
    }
    this.publisher.send('events', topics.events(id.tenantId, id.hubId), event);
    for (const fn of [this.uploader, ...this.listeners]) {
      if (!fn) continue;
      try {
        fn(event);
      } catch (e) {
        this.onError(e);
      }
    }
    return event;
  }
}
