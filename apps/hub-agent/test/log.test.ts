import { existsSync, mkdtempSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Writable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { createLogger, redactPayload } from '../src/log/index.js';

function sink() {
  const lines: string[] = [];
  const stream = new Writable({
    write(chunk, _e, cb) {
      lines.push(String(chunk));
      cb();
    },
  });
  return { lines, stream };
}

describe('logger', () => {
  it('emits JSON lines', () => {
    const s = sink();
    const log = createLogger({ stream: s.stream, level: 'info' });
    log.info({ a: 1 }, 'hello');
    expect(JSON.parse(s.lines[0])).toMatchObject({ a: 1, msg: 'hello', name: 'hub-agent' });
  });

  it('payload hidden at info, visible at debug', () => {
    const s = sink();
    const info = createLogger({ stream: s.stream, level: 'info' });
    info.info(redactPayload(info, { topic: 't', payload: { secret: 1 } }), 'set');
    expect(s.lines[0]).not.toContain('secret');
    expect(s.lines[0]).toContain('[redacted]');
    expect(s.lines[0]).toContain('"topic":"t"');

    const s2 = sink();
    const dbg = createLogger({ stream: s2.stream, level: 'debug' });
    dbg.debug(redactPayload(dbg, { topic: 't', payload: { secret: 1 } }), 'set');
    expect(s2.lines[0]).toContain('secret');
  });

  it('creates the logs dir when file logging is requested', async () => {
    const dir = join(mkdtempSync(join(tmpdir(), 'log-')), 'logs');
    const log = createLogger({ logsDir: dir, level: 'info' });
    log.info('x');
    await new Promise((r) => setTimeout(r, 300));
    expect(existsSync(dir)).toBe(true);
    expect(Array.isArray(readdirSync(dir))).toBe(true);
  });
});

describe('redaction at info (NFR)', () => {
  it('set/state/values payloads never appear in info lines', () => {
    const s = sink();
    const log = createLogger({ stream: s.stream, level: 'info' });
    for (const topic of ['t/x/h/y/d/dev_1/set', 't/x/h/y/d/dev_1/state']) {
      log.info(redactPayload(log, { topic, payload: { values: { state: 'SECRET-ON' } } }), 'msg');
    }
    expect(s.lines).toHaveLength(2);
    expect(s.lines.join('')).not.toContain('SECRET-ON');
  });
});
