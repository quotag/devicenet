import { existsSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EventEmitter } from 'node:events';
import type { ChildProcess } from 'node:child_process';
import { pino } from 'pino';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ManagedChild, killStalePids } from '../../src/supervisor/child.js';

const log = pino({ level: 'silent' });
const live: ManagedChild[] = [];
afterEach(async () => {
  await Promise.all(live.splice(0).map((c) => c.stop()));
});
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function until(fn: () => boolean, ms = 8000) {
  const end = Date.now() + ms;
  while (!fn() && Date.now() < end) await wait(25);
  expect(fn()).toBe(true);
}
const runDir = () => join(mkdtempSync(join(tmpdir(), 'dn-ch-')), 'run');
const SLEEP = ['-e', 'setTimeout(()=>{},60000)'];

describe('ManagedChild', () => {
  it('writes pid file, restarts after crash, stops cleanly', async () => {
    let starts = 0;
    const c = new ManagedChild({
      name: 'dummy', command: process.execPath, args: ['-e', 'console.log("hi");setTimeout(()=>process.exit(1),100)'],
      runDir: runDir(), log, backoffMinMs: 50, backoffMaxMs: 200, onStart: () => starts++,
    });
    live.push(c);
    await c.start();
    expect(existsSync(c.pidFile)).toBe(true);
    await until(() => starts >= 3);
    await c.stop();
    expect(existsSync(c.pidFile)).toBe(false);
    const n = starts;
    await wait(300);
    expect(starts).toBe(n);
  });

  it('emits child_crashloop after more than 3 crashes in the window', async () => {
    const warns: any[] = [];
    const c = new ManagedChild({
      name: 'loop', command: process.execPath, args: ['-e', 'process.exit(2)'], runDir: runDir(), log,
      backoffMinMs: 10, backoffMaxMs: 20, onWarning: (w) => warns.push(w),
    });
    live.push(c);
    await c.start();
    await until(() => warns.length > 0);
    expect(warns[0]).toMatchObject({ code: 'child_crashloop', child: 'loop' });
  });

  it('backoff doubles up to the max (fake clock, fake child)', async () => {
    vi.useFakeTimers();
    try {
      const times: number[] = [];
      const spawnFn = () => {
        const p = new EventEmitter() as EventEmitter & { pid: number; stdout: null; stderr: null; exitCode: number | null; signalCode: null; kill(): void };
        Object.assign(p, { pid: 4242, stdout: null, stderr: null, exitCode: null, signalCode: null, kill() {} });
        setTimeout(() => p.emit('exit', 1, null), 1); // crash right after start
        return p as unknown as ChildProcess;
      };
      const c = new ManagedChild({
        name: 'bo', command: 'x', runDir: runDir(), log, spawnFn, crashThreshold: 1000,
        backoffMinMs: 100, backoffMaxMs: 300, onStart: () => times.push(Date.now()),
      });
      live.push(c);
      await c.start();
      await vi.advanceTimersByTimeAsync(5000);
      const gaps = times.slice(1, 6).map((t, i) => t - times[i]! - 1); // minus the 1 ms run time
      expect(gaps).toEqual([100, 200, 300, 300, 300]);
      await c.stop();
    } finally {
      vi.useRealTimers();
    }
  });

  it('stop kills a running child', async () => {
    const c = new ManagedChild({ name: 'long', command: process.execPath, args: SLEEP, runDir: runDir(), log });
    live.push(c);
    await c.start();
    const pid = c.pid!;
    await c.stop();
    expect(c.running).toBe(false);
    expect(() => process.kill(pid, 0)).toThrow();
  });

  it('kills a stale pid left by a previous run', async () => {
    const dir = runDir();
    const first = new ManagedChild({ name: 'st', command: process.execPath, args: SLEEP, runDir: dir, log });
    await first.start();
    const stale = first.pid!;
    const killed = await killStalePids(dir, ['st']);
    expect(killed).toContain(stale);
    await wait(300);
    expect(() => process.kill(stale, 0)).toThrow();
    writeFileSync(join(dir, 'st.pid'), '999999');
    expect(await killStalePids(dir, ['st'])).toEqual([]);
    await first.stop();
  });
});
