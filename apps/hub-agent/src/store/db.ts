import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { MIGRATIONS } from './migrations.js';

const require = createRequire(import.meta.url);

export type SqlValue = string | number | bigint | null | Uint8Array;

export interface Statement {
  run(...params: SqlValue[]): { changes: number | bigint };
  get(...params: SqlValue[]): Record<string, unknown> | undefined;
  all(...params: SqlValue[]): Record<string, unknown>[];
}

/** Minimal sync SQLite surface shared by better-sqlite3 (preferred) and node:sqlite (fallback). */
export interface Db {
  readonly engine: 'better-sqlite3' | 'node:sqlite';
  exec(sql: string): void;
  prepare(sql: string): Statement;
  /** run `fn` inside BEGIN/COMMIT (ROLLBACK on throw); nested calls join the outer tx */
  tx<T>(fn: () => T): T;
  close(): void;
}

export interface OpenOptions {
  /** force an engine (tests); default: better-sqlite3, falling back to node:sqlite if its native binding is missing */
  engine?: 'better-sqlite3' | 'node:sqlite';
}

function wrap(engine: Db['engine'], raw: any): Db {
  let depth = 0;
  return {
    engine,
    exec: (sql) => void raw.exec(sql),
    prepare: (sql) => raw.prepare(sql) as Statement,
    tx<T>(fn: () => T): T {
      if (depth > 0) return fn();
      raw.exec('BEGIN');
      depth++;
      try {
        const r = fn();
        raw.exec('COMMIT');
        return r;
      } catch (e) {
        raw.exec('ROLLBACK');
        throw e;
      } finally {
        depth--;
      }
    },
    close: () => void raw.close(),
  };
}

function openRaw(file: string, engine?: Db['engine']): Db {
  if (engine !== 'node:sqlite') {
    try {
      const BetterSqlite3 = require('better-sqlite3');
      return wrap('better-sqlite3', new BetterSqlite3(file));
    } catch (e) {
      if (engine === 'better-sqlite3') throw e;
    }
  }
  // Fallback (e.g. native binding not built on a dev machine). Same SQL, same semantics for our use.
  const { DatabaseSync } = require('node:sqlite');
  return wrap('node:sqlite', new DatabaseSync(file));
}

/** Open (creating dirs) + WAL + apply migrations. Use ':memory:' for tests. */
export function openDb(file: string, opts: OpenOptions = {}): Db {
  if (file !== ':memory:') mkdirSync(dirname(file), { recursive: true });
  const db = openRaw(file, opts.engine);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
  migrate(db);
  return db;
}

export function migrate(db: Db): number {
  db.exec('CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT)');
  const row = db.prepare("SELECT value FROM meta WHERE key = 'schemaVersion'").get();
  const current = row ? Number(row.value) : 0;
  const pending = MIGRATIONS.filter((m) => m.version > current);
  if (pending.length === 0) return current;
  db.tx(() => {
    for (const m of pending) db.exec(m.sql);
    db.prepare("INSERT INTO meta(key, value) VALUES('schemaVersion', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(
      String(pending[pending.length - 1].version),
    );
  });
  return pending[pending.length - 1].version;
}
