/** Numbered SQL migrations (data-model.md §2). Applied at boot inside one transaction. */
export interface Migration {
  version: number;
  sql: string;
}

export const MIGRATIONS: Migration[] = [
  {
    version: 1,
    sql: `
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT);

CREATE TABLE devices (
  id TEXT PRIMARY KEY,
  external_id TEXT NOT NULL UNIQUE,
  doc TEXT NOT NULL,
  "values" TEXT NOT NULL DEFAULT '{}',
  at TEXT NOT NULL DEFAULT '{}',
  online INTEGER NOT NULL DEFAULT 0,
  last_seen INTEGER NOT NULL DEFAULT 0,
  synced INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE config_snapshot (
  kind TEXT PRIMARY KEY CHECK (kind IN ('site','rooms','devices','rules','scenes','layout')),
  json TEXT NOT NULL,
  etag TEXT,
  cached_at INTEGER NOT NULL
);

CREATE TABLE history (
  device_id TEXT NOT NULL,
  property TEXT NOT NULL,
  ts INTEGER NOT NULL,
  value REAL NOT NULL
);
CREATE INDEX history_dev_prop_ts ON history (device_id, property, ts);

CREATE TABLE events (
  id TEXT PRIMARY KEY,
  ts INTEGER NOT NULL,
  type TEXT NOT NULL,
  json TEXT NOT NULL,
  uploaded INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX events_ts ON events (ts);

CREATE TABLE rule_state (
  rule_id TEXT PRIMARY KEY,
  last_run_at INTEGER,
  last_result TEXT,
  pending_write INTEGER NOT NULL DEFAULT 0
);
`,
  },
];
