import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import pino, { type DestinationStream, type Logger } from 'pino';

export type { Logger };

export interface LoggerOptions {
  level?: string;
  /** when set, also write daily-rotated files (keep 7) into `<dataDir>/logs` */
  logsDir?: string;
  /** override destination (tests) */
  stream?: DestinationStream;
  name?: string;
}

/** Fields carrying set/state payloads: only visible at debug level (FR-H01). */
const PAYLOAD_KEYS = ['payload', 'values', 'raw'] as const;

/** Return `obj` with payload-carrying fields masked unless the logger is at debug or lower. */
export function redactPayload<T extends Record<string, unknown>>(log: Pick<Logger, 'isLevelEnabled'>, obj: T): Partial<T> {
  if (log.isLevelEnabled('debug')) return obj;
  const out: Record<string, unknown> = { ...obj };
  for (const k of PAYLOAD_KEYS) if (k in out) out[k] = '[redacted]';
  return out as Partial<T>;
}

export function createLogger(opts: LoggerOptions = {}): Logger {
  const level = opts.level ?? 'info';
  const base = { name: opts.name ?? 'hub-agent' };
  if (opts.stream) return pino({ level, ...base }, opts.stream);
  if (!opts.logsDir) return pino({ level, ...base });
  mkdirSync(opts.logsDir, { recursive: true });
  const transport = pino.transport({
    targets: [
      { target: 'pino/file', level, options: { destination: 1 } },
      {
        target: 'pino-roll',
        level,
        options: {
          file: join(opts.logsDir, 'hub'),
          frequency: 'daily',
          dateFormat: 'yyyy-MM-dd',
          extension: '.log',
          mkdir: true,
          limit: { count: 7 },
        },
      },
    ],
  });
  return pino({ level, ...base }, transport);
}
