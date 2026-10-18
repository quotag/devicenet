import { openDb, type Db, type OpenOptions } from './db.js';
import { DevicesRepo } from './devices.js';
import { EventsRepo } from './events.js';
import { HistoryRepo } from './history.js';
import { SnapshotRepo } from './snapshot.js';

export * from './db.js';
export * from './devices.js';
export * from './events.js';
export * from './history.js';
export * from './snapshot.js';

export interface Store {
  db: Db;
  devices: DevicesRepo;
  snapshot: SnapshotRepo;
  events: EventsRepo;
  history: HistoryRepo;
  close(): void;
}

export function openStore(file: string, opts?: OpenOptions): Store {
  const db = openDb(file, opts);
  return {
    db,
    devices: new DevicesRepo(db),
    snapshot: new SnapshotRepo(db),
    events: new EventsRepo(db),
    history: new HistoryRepo(db),
    close: () => db.close(),
  };
}
