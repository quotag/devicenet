import { spawn, execFile, type ChildProcess, type SpawnOptions } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Logger } from 'pino';

export interface ChildWarning {
  code: 'child_crashloop';
  child: string;
  crashes: number;
}

export interface ManagedChildOptions {
  name: string;
  command: string;
  args?: string[];
  env?: NodeJS.ProcessEnv;
  cwd?: string;
  /** `<dataDir>/run` */
  runDir: string;
  log: Logger;
  onWarning?: (w: ChildWarning) => void;
  onExit?: (code: number | null, signal: NodeJS.Signals | null) => void;
  onStart?: (pid: number) => void;
  backoffMinMs?: number;
  backoffMaxMs?: number;
  /** more than `crashThreshold` crashes within this window => warning */
  crashWindowMs?: number;
  crashThreshold?: number;
  stopGraceMs?: number;
  /** a run longer than this resets the backoff */
  stableMs?: number;
  spawnFn?: (cmd: string, args: string[], opts: SpawnOptions) => ChildProcess;
}

const isWin = process.platform === 'win32';

function taskkill(pid: number): Promise<void> {
  return new Promise((resolve) => {
    execFile('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true }, () => resolve());
  });
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === 'EPERM';
  }
}

/** Kill a pid (whole tree on Windows). */
export async function killPid(pid: number): Promise<void> {
  if (isWin) await taskkill(pid);
  else {
    try {
      process.kill(pid, 'SIGKILL');
    } catch {
      /* already gone */
    }
  }
}

/** Kill processes left by a previous run (no parent-death signal on Windows). Returns killed pids. */
export async function killStalePids(runDir: string, names: string[]): Promise<number[]> {
  const killed: number[] = [];
  for (const n of names) {
    const file = join(runDir, `${n}.pid`);
    let pid = NaN;
    try {
      pid = Number.parseInt(readFileSync(file, 'utf8').trim(), 10);
    } catch {
      continue;
    }
    if (Number.isInteger(pid) && pid > 0 && pid !== process.pid && alive(pid)) {
      await killPid(pid);
      killed.push(pid);
    }
    rmSync(file, { force: true });
  }
  return killed;
}

/** Spawn a child without a shell; restart with exponential backoff; detect crash loops. */
export class ManagedChild {
  private proc?: ChildProcess;
  private stopping = false;
  private timer?: NodeJS.Timeout;
  private consecutive = 0;
  private crashTimes: number[] = [];
  private startedAt = 0;
  private exitWaiters: Array<() => void> = [];
  private readonly o: ManagedChildOptions &
    Required<Pick<ManagedChildOptions, 'backoffMinMs' | 'backoffMaxMs' | 'crashWindowMs' | 'crashThreshold' | 'stopGraceMs' | 'stableMs'>>;

  constructor(opts: ManagedChildOptions) {
    this.o = {
      backoffMinMs: 2000,
      backoffMaxMs: 30000,
      crashWindowMs: 10 * 60_000,
      crashThreshold: 3,
      stopGraceMs: 5000,
      stableMs: 60_000,
      ...opts,
    };
  }

  get pid(): number | undefined {
    return this.proc?.pid;
  }
  get running(): boolean {
    return !!this.proc && this.proc.exitCode === null && this.proc.signalCode === null;
  }
  get pidFile(): string {
    return join(this.o.runDir, `${this.o.name}.pid`);
  }

  async start(): Promise<void> {
    this.stopping = false;
    await killStalePids(this.o.runDir, [this.o.name]);
    this.spawnNow();
  }

  private spawnNow(): void {
    const { name, log } = this.o;
    const spawnFn = this.o.spawnFn ?? spawn;
    mkdirSync(this.o.runDir, { recursive: true });
    const p = spawnFn(this.o.command, this.o.args ?? [], {
      shell: false,
      windowsHide: true,
      cwd: this.o.cwd,
      env: this.o.env ? { ...process.env, ...this.o.env } : process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    this.proc = p;
    this.startedAt = Date.now();
    if (p.pid) {
      writeFileSync(this.pidFile, String(p.pid));
      this.o.onStart?.(p.pid);
    }
    log.info({ child: name, pid: p.pid }, 'child started');
    const pipe = (stream: NodeJS.ReadableStream | null, level: 'info' | 'warn') => {
      let buf = '';
      stream?.on('data', (d: Buffer) => {
        buf += d.toString('utf8');
        let i: number;
        while ((i = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, i).replace(/\r$/, '');
          buf = buf.slice(i + 1);
          if (line) log[level]({ child: name }, line);
        }
      });
    };
    pipe(p.stdout, 'info');
    pipe(p.stderr, 'warn');
    p.on('error', (err) => {
      log.error({ child: name, err: err.message }, 'child spawn error');
      this.handleExit(p, null, null);
    });
    p.on('exit', (code, signal) => this.handleExit(p, code, signal));
  }

  private handleExit(p: ChildProcess, code: number | null, signal: NodeJS.Signals | null): void {
    if (this.proc !== p) return;
    this.proc = undefined;
    rmSync(this.pidFile, { force: true });
    const waiters = this.exitWaiters;
    this.exitWaiters = [];
    waiters.forEach((w) => w());
    this.o.onExit?.(code, signal);
    if (this.stopping) return;
    const now = Date.now();
    if (now - this.startedAt > this.o.stableMs) this.consecutive = 0;
    this.crashTimes = this.crashTimes.filter((t) => now - t < this.o.crashWindowMs);
    this.crashTimes.push(now);
    if (this.crashTimes.length > this.o.crashThreshold) {
      this.o.log.warn({ child: this.o.name, crashes: this.crashTimes.length, code: 'child_crashloop' }, 'child crash loop');
      this.o.onWarning?.({ code: 'child_crashloop', child: this.o.name, crashes: this.crashTimes.length });
    }
    const delay = Math.min(this.o.backoffMaxMs, this.o.backoffMinMs * 2 ** this.consecutive);
    this.consecutive++;
    this.o.log.warn({ child: this.o.name, exitCode: code, signal, restartInMs: delay }, 'child exited, restarting');
    this.timer = setTimeout(() => {
      this.timer = undefined;
      if (!this.stopping) this.spawnNow();
    }, delay);
  }

  /** Stop then start again (not counted as a crash). */
  async restart(): Promise<void> {
    await this.stop();
    await this.start();
  }

  async stop(): Promise<void> {
    this.stopping = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
    const p = this.proc;
    if (!p || !this.running) return;
    const exited = new Promise<void>((res) => this.exitWaiters.push(res));
    p.kill();
    const grace = new Promise<'timeout'>((res) => setTimeout(() => res('timeout'), this.o.stopGraceMs).unref());
    const r = await Promise.race([exited.then(() => 'exited' as const), grace]);
    if (r === 'timeout' && p.pid) {
      if (isWin) await taskkill(p.pid);
      else p.kill('SIGKILL');
      await Promise.race([exited, new Promise((res) => setTimeout(res, 2000).unref())]);
    }
  }
}
