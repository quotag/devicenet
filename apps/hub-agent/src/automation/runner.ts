import { z } from 'zod';
import { Action, type Rule, type RunProgress, type Scene } from '@devicenet/shared';
import type { Clock, TimerHandle, TimerHost } from '../core/clock.js';
import { realClock, realTimers } from '../core/clock.js';
import type { HubEventBody } from '../core/events.js';
import { newId } from '../core/ids.js';
import type { SetOutcome } from '../core/setQueue.js';

type Log = { warn(obj: object, msg?: string): void; info?(obj: object, msg?: string): void; debug?(obj: object, msg?: string): void };

export type RunSource = RunProgress['source'];
export type RunStatus = RunProgress['status'];
export type FinalResult = 'ok' | 'partial' | 'failed';
type StepStatus = RunProgress['steps'][number]['status'];
interface Step {
  index: number;
  status: StepStatus;
  error?: string;
}

export const ActionList = z.array(Action).min(1).max(20);

export interface RunnerOptions {
  publisher: { publishHub(kind: 'runs', body: object): unknown };
  events: { emit(body: HubEventBody): unknown };
  /** the same per-device queue as MQTT `set` (FR-H05) */
  setQueue: { handle(deviceId: string, payload: unknown): Promise<SetOutcome> };
  /** current scene doc (latest Firestore/snapshot view) */
  getScene: (sceneId: string) => Scene | undefined;
  /** current rule doc — used to cancel a run whose rule was disabled / changed rev */
  getRule: (ruleId: string) => Rule | undefined;
  /** lastRunAt/lastResult sink (configApply coalesces the Firestore write) */
  onResult?: (source: RunSource, result: FinalResult, at: number) => void;
  clock?: Clock;
  timers?: TimerHost;
  /** start a scene/test run after the ack went out (default setImmediate) */
  defer?: (fn: () => void) => void;
  log?: Log;
}

export interface RunHandle {
  runId: string;
  done: Promise<RunStatus>;
  cancel(): void;
}

class Cancelled extends Error {}

interface ActiveRun {
  runId: string;
  source: RunSource;
  /** rev of the rule at start (rule runs only) */
  rev?: number;
  cancelled: boolean;
  delay?: { timer: TimerHandle; reject: (e: Error) => void };
}

const MAX_ERR = 200;

/**
 * Action runner (FR-H08, realtime §5, data-model §3.5): `run_` id, actions in order, `RunProgress`
 * on `runs` each time a step changes, `setProperty` via the set queue, cancellable `delay`,
 * `runScene` one level deep, `notify` → `events notify`. A rule run is cancelled when the rule is
 * disabled or its rev changes mid-run (`rulesChanged`).
 */
export class ActionRunner {
  private active = new Map<string, ActiveRun>();
  private readonly clock: Clock;
  private readonly timers: TimerHost;
  private readonly defer: (fn: () => void) => void;

  constructor(private readonly o: RunnerOptions) {
    this.clock = o.clock ?? realClock;
    this.timers = o.timers ?? realTimers;
    this.defer = o.defer ?? ((fn) => void setImmediate(fn));
  }

  /** runs in progress (runId → source) */
  activeRuns(): Array<{ runId: string; source: RunSource }> {
    return [...this.active.values()].map((r) => ({ runId: r.runId, source: r.source }));
  }

  /** Rule fired (engine onFire). A rule already running is not started again (single mode, TODO-OQ). */
  runRule(rule: Rule): RunHandle | null {
    for (const r of this.active.values()) {
      if (r.source.kind === 'rule' && r.source.ruleId === rule.id) {
        this.o.log?.debug?.({ ruleId: rule.id, runId: r.runId }, 'rule already running; fire ignored');
        return null;
      }
    }
    return this.start({ kind: 'rule', ruleId: rule.id }, rule.actions, rule.rev, false);
  }

  /** `scene.run`: returns null when the scene is unknown. Execution starts after the caller's ack. */
  runScene(sceneId: string): RunHandle | null {
    const scene = this.o.getScene(sceneId);
    if (!scene) return null;
    return this.start({ kind: 'scene', sceneId }, scene.actions, undefined, true);
  }

  /** `actions.test`: validated actions, not saved; `source.kind="test"`. */
  runTest(actions: Action[]): RunHandle {
    return this.start({ kind: 'test' }, actions, undefined, true);
  }

  /** Cancel rule runs whose rule disappeared, was disabled or changed rev. */
  rulesChanged(): void {
    for (const r of this.active.values()) {
      if (r.source.kind !== 'rule') continue;
      const rule = this.o.getRule(r.source.ruleId);
      if (!rule || !rule.enabled || rule.rev !== r.rev) this.cancelRun(r);
    }
  }

  /** Cancel everything (shutdown). */
  stop(): void {
    for (const r of this.active.values()) this.cancelRun(r);
  }

  private cancelRun(r: ActiveRun): void {
    if (r.cancelled) return;
    r.cancelled = true;
    if (r.delay) {
      r.delay.timer.cancel();
      r.delay.reject(new Cancelled());
    }
  }

  private start(source: RunSource, actions: Action[], rev: number | undefined, deferred: boolean): RunHandle {
    const run: ActiveRun = { runId: newId('run'), source, cancelled: false, ...(rev !== undefined ? { rev } : {}) };
    this.active.set(run.runId, run);
    const done = new Promise<RunStatus>((resolve) => {
      const go = () =>
        this.execute(run, actions).then(resolve, (e) => {
          this.o.log?.warn({ runId: run.runId, err: (e as Error).message }, 'run crashed');
          resolve('failed');
        });
      if (deferred) this.defer(go);
      else go();
    }).finally(() => this.active.delete(run.runId));
    return { runId: run.runId, done, cancel: () => this.cancelRun(run) };
  }

  private publish(run: ActiveRun, status: RunStatus, steps: Step[]): void {
    const body: Omit<RunProgress, 'v' | 'ts' | 'seq'> = {
      runId: run.runId,
      source: run.source,
      status,
      total: steps.length,
      steps: steps.map((s) => ({ ...s })),
    };
    try {
      this.o.publisher.publishHub('runs', body);
    } catch (e) {
      this.o.log?.warn({ runId: run.runId, err: (e as Error).message }, 'runs publish failed');
    }
  }

  private async execute(run: ActiveRun, actions: Action[]): Promise<RunStatus> {
    const steps: Step[] = actions.map((_, index) => ({ index, status: 'pending' }));
    const at = this.clock.now();
    let status: RunStatus = 'running';
    for (let i = 0; i < actions.length; i++) {
      const step = steps[i]!;
      if (run.cancelled) break;
      step.status = 'running';
      this.publish(run, 'running', steps);
      try {
        const err = await this.step(run, actions[i]!, 0);
        if (err) {
          step.status = 'failed';
          step.error = err.slice(0, MAX_ERR);
        } else step.status = 'ok';
      } catch (e) {
        if (e instanceof Cancelled || run.cancelled) {
          step.status = 'skipped';
          break;
        }
        step.status = 'failed';
        step.error = ((e as Error)?.message ?? String(e)).slice(0, MAX_ERR);
      }
    }
    if (run.cancelled) {
      for (const s of steps) if (s.status === 'pending' || s.status === 'running') s.status = 'skipped';
      status = 'cancelled';
    } else {
      status = finalStatus(actions, steps);
    }
    this.publish(run, status, steps);
    this.finish(run, status, at);
    return status;
  }

  /** Run one action. Returns an error string on failure; throws Cancelled when the run is cancelled. */
  private async step(run: ActiveRun, a: Action, depth: number): Promise<string | undefined> {
    switch (a.type) {
      case 'setProperty': {
        const r = await this.o.setQueue.handle(a.deviceId, { values: { [a.property]: a.value } });
        if (!r.ok) return r.reason;
        return r.confirmed ? undefined : 'not_confirmed';
      }
      case 'delay':
        await this.sleep(run, a.seconds * 1000);
        return undefined;
      case 'notify':
        this.o.events.emit({
          type: 'notify',
          title: a.title,
          ...(a.body !== undefined ? { body: a.body } : {}),
          level: a.level,
          ...(run.source.kind === 'rule' ? { ruleId: run.source.ruleId } : {}),
        });
        return undefined;
      case 'runScene': {
        // one level only: a scene started from a run may not start scenes itself
        if (depth > 0) return 'scene_nesting_too_deep';
        const scene = this.o.getScene(a.sceneId);
        if (!scene) return `scene_not_found:${a.sceneId}`;
        if (scene.lastResult === 'broken') return `scene_broken:${scene.brokenReason ?? ''}`;
        const errors: string[] = [];
        let okCount = 0;
        for (const sub of scene.actions) {
          if (run.cancelled) throw new Cancelled();
          const err = await this.step(run, sub, depth + 1);
          if (err) errors.push(err);
          else if (sub.type !== 'delay') okCount++;
        }
        if (errors.length === 0) return undefined;
        return `${okCount > 0 ? 'scene_partial' : 'scene_failed'}:${errors[0]}`;
      }
    }
  }

  private sleep(run: ActiveRun, ms: number): Promise<void> {
    if (run.cancelled) return Promise.reject(new Cancelled());
    return new Promise<void>((resolve, reject) => {
      const timer = this.timers.setTimeout(() => {
        run.delay = undefined;
        resolve();
      }, ms);
      run.delay = {
        timer,
        reject: (e) => {
          run.delay = undefined;
          reject(e);
        },
      };
    });
  }

  private finish(run: ActiveRun, status: RunStatus, at: number): void {
    if (status === 'cancelled' || status === 'running') {
      this.o.log?.info?.({ runId: run.runId, source: run.source }, 'run cancelled');
      return; // TODO-OQ: no rule.fired/scene.run event shape for "cancelled"
    }
    const src = run.source;
    try {
      if (src.kind === 'rule') this.o.events.emit({ type: 'rule.fired', ruleId: src.ruleId, runId: run.runId, result: status });
      else if (src.kind === 'scene') this.o.events.emit({ type: 'scene.run', sceneId: src.sceneId, runId: run.runId, result: status });
    } catch (e) {
      this.o.log?.warn({ runId: run.runId, err: (e as Error).message }, 'run event failed');
    }
    if (src.kind !== 'test') this.o.onResult?.(src, status, at);
  }
}

/** ok = no failure; failed = every non-delay step failed; else partial. */
export function finalStatus(actions: Action[], steps: Step[]): FinalResult {
  const failed = steps.filter((s) => s.status === 'failed').length;
  if (failed === 0) return 'ok';
  const effective = actions.filter((a) => a.type !== 'delay').length;
  return failed >= effective ? 'failed' : 'partial';
}
