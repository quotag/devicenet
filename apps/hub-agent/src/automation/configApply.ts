import type { Rule, Scene } from '@devicenet/shared';
import type { Clock, TimerHandle, TimerHost } from '../core/clock.js';
import { realClock, realTimers } from '../core/clock.js';
import type { HubEventBody } from '../core/events.js';
import type { Db } from '../store/db.js';
import type { ConfigStore, RuleHubFields, SceneHubFields } from '../sync/ConfigStore.js';
import type { FinalResult, RunSource } from './runner.js';

type Log = { warn(obj: object, msg?: string): void; debug?(obj: object, msg?: string): void };

export interface ConfigApplyOptions {
  configStore: () => ConfigStore | null | undefined;
  events: { emit(body: HubEventBody): unknown };
  /** SQLite (rule_state); without it lastRunAt is kept in memory only */
  db?: Db;
  clock?: Clock;
  timers?: TimerHost;
  /** min interval between two lastRunAt/lastResult writes of one rule/scene (data-model: ≤ 1 / 10 s) */
  resultIntervalMs?: number;
  log?: Log;
}

export interface HubFieldWrite {
  kind: 'rule' | 'scene';
  id: string;
  patch: RuleHubFields | SceneHubFields;
}

interface Pending {
  kind: 'rule' | 'scene';
  lastRunAt: number;
  lastResult: FinalResult;
}

/**
 * Config apply (data-model §3.4): after the engine loaded a snapshot, write `appliedRev = rev`
 * for every changed rule/scene in one batch and emit `events config.applied`.
 * Run results (`lastRunAt`/`lastResult`) are persisted in SQLite `rule_state` and coalesced to
 * at most one Firestore write per rule/scene per 10 s.
 */
export class ConfigApply {
  /** id → rev already written (or in flight) */
  private applied = new Map<string, number>();
  private lastWriteAt = new Map<string, number>();
  private pending = new Map<string, Pending>();
  private timers = new Map<string, TimerHandle>();
  private readonly clock: Clock;
  private readonly th: TimerHost;
  private readonly interval: number;

  constructor(private readonly o: ConfigApplyOptions) {
    this.clock = o.clock ?? realClock;
    this.th = o.timers ?? realTimers;
    this.interval = o.resultIntervalMs ?? 10_000;
    this.loadPending();
  }

  /**
   * Call after the engine has loaded `rules`/`scenes`. `broken` = extra hub fields per id
   * (scene broken detection). Returns the ids written.
   */
  async apply(rules: Rule[], scenes: Scene[], extra: HubFieldWrite[] = []): Promise<{ ruleIds: string[]; sceneIds: string[] }> {
    const store = this.o.configStore();
    if (!store) return { ruleIds: [], sceneIds: [] };
    const writes = new Map<string, HubFieldWrite>();
    const ruleIds: string[] = [];
    const sceneIds: string[] = [];
    const want = (kind: 'rule' | 'scene', d: Rule | Scene) => {
      if (d.appliedRev === d.rev || this.applied.get(d.id) === d.rev) return;
      writes.set(d.id, { kind, id: d.id, patch: { appliedRev: d.rev } });
      (kind === 'rule' ? ruleIds : sceneIds).push(d.id);
    };
    for (const r of rules) want('rule', r);
    for (const s of scenes) want('scene', s);
    for (const x of extra) {
      const cur = writes.get(x.id);
      writes.set(x.id, cur ? { ...cur, patch: { ...cur.patch, ...x.patch } } : x);
    }
    if (writes.size === 0) return { ruleIds, sceneIds };

    const revs = new Map<string, number>();
    for (const d of [...rules, ...scenes]) if (writes.get(d.id)?.patch.appliedRev !== undefined) revs.set(d.id, d.rev);
    for (const [id, rev] of revs) this.applied.set(id, rev);
    try {
      await writeBatch(store, [...writes.values()]);
    } catch (e) {
      for (const id of revs.keys()) this.applied.delete(id); // retry on next snapshot / resync
      this.o.log?.warn({ err: (e as Error).message, n: writes.size }, 'appliedRev write failed');
      return { ruleIds: [], sceneIds: [] };
    }
    if (ruleIds.length + sceneIds.length > 0) {
      const revList = [...revs.values()];
      const single = revList.length === 1 ? { rev: revList[0]! } : {};
      this.o.events.emit({ type: 'config.applied', ruleIds, sceneIds, ...single });
    }
    return { ruleIds, sceneIds };
  }

  /** Forget applied revs (e.g. after a config store switch) so the next apply re-checks every doc. */
  reset(): void {
    this.applied.clear();
  }

  /** Runner result sink: rule_state upsert + coalesced Firestore write. */
  recordResult(source: RunSource, result: FinalResult, at: number): void {
    if (source.kind === 'test') return;
    const id = source.kind === 'rule' ? source.ruleId : source.sceneId;
    this.pending.set(id, { kind: source.kind, lastRunAt: at, lastResult: result });
    try {
      this.o.db
        ?.prepare(
          `INSERT INTO rule_state (rule_id, last_run_at, last_result, pending_write) VALUES (?, ?, ?, 1)
           ON CONFLICT(rule_id) DO UPDATE SET last_run_at = excluded.last_run_at, last_result = excluded.last_result, pending_write = 1`,
        )
        .run(id, at, result);
    } catch (e) {
      this.o.log?.warn({ id, err: (e as Error).message }, 'rule_state write failed');
    }
    this.schedule(id);
  }

  /** Write every pending result now (sign-in, shutdown). */
  async flushAll(): Promise<void> {
    await Promise.all([...this.pending.keys()].map((id) => this.flush(id)));
  }

  stop(): void {
    for (const t of this.timers.values()) t.cancel();
    this.timers.clear();
  }

  private schedule(id: string): void {
    if (this.timers.has(id)) return;
    const since = this.clock.now() - (this.lastWriteAt.get(id) ?? -Infinity);
    const wait = Math.max(0, this.interval - since);
    if (wait === 0) {
      void this.flush(id);
      return;
    }
    this.timers.set(
      id,
      this.th.setTimeout(() => {
        this.timers.delete(id);
        void this.flush(id);
      }, wait),
    );
  }

  private async flush(id: string): Promise<void> {
    const p = this.pending.get(id);
    const store = this.o.configStore();
    if (!p || !store) return;
    this.pending.delete(id);
    this.lastWriteAt.set(id, this.clock.now());
    const patch = { lastRunAt: p.lastRunAt, lastResult: p.lastResult };
    try {
      if (p.kind === 'rule') await store.updateRuleHubFields(id, patch);
      else await store.updateSceneHubFields(id, patch);
      if (!this.pending.has(id)) this.o.db?.prepare('UPDATE rule_state SET pending_write = 0 WHERE rule_id = ?').run(id);
    } catch (e) {
      if (!this.pending.has(id)) this.pending.set(id, p); // keep for the next attempt (sign-in / next result)
      this.o.log?.warn({ id, err: (e as Error).message }, 'lastRunAt write failed');
    }
  }

  private loadPending(): void {
    try {
      const rows = this.o.db?.prepare('SELECT rule_id, last_run_at, last_result FROM rule_state WHERE pending_write = 1').all() ?? [];
      for (const r of rows) {
        const id = String(r.rule_id);
        const result = r.last_result as FinalResult;
        if (r.last_run_at === null || !['ok', 'partial', 'failed'].includes(result)) continue;
        this.pending.set(id, { kind: id.startsWith('scn_') ? 'scene' : 'rule', lastRunAt: Number(r.last_run_at), lastResult: result });
      }
    } catch (e) {
      this.o.log?.warn({ err: (e as Error).message }, 'rule_state load failed');
    }
  }
}

/** One Firestore batch when the store supports it, else sequential updates. */
export async function writeBatch(store: ConfigStore, writes: HubFieldWrite[]): Promise<void> {
  if (writes.length === 0) return;
  if (store.batchHubFields) {
    await store.batchHubFields(writes);
    return;
  }
  for (const w of writes) {
    if (w.kind === 'rule') await store.updateRuleHubFields(w.id, w.patch);
    else await store.updateSceneHubFields(w.id, w.patch);
  }
}
