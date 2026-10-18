import { describe, expect, it, vi } from 'vitest';
import { CommandAck, RunProgress, Scene, topics, type Action, type Rule } from '@devicenet/shared';
import { FakeTime } from '../../src/core/clock.js';
import { createHubCore } from '../../src/core/hubCore.js';
import { newId } from '../../src/core/ids.js';
import { ActionRunner, type RunSource } from '../../src/automation/runner.js';
import { ConfigApply } from '../../src/automation/configApply.js';
import { RuleSync } from '../../src/sync/ruleSync.js';
import type { SetOutcome } from '../../src/core/setQueue.js';
import { openStore } from '../../src/store/index.js';
import { buildProperties } from '../../src/drivers/zigbee2mqtt/exposes.js';
import { fromDriverValue, toDriverValue } from '../../src/drivers/zigbee2mqtt/values.js';
import type { Driver } from '../../src/drivers/Driver.js';
import { FakeConfigStore } from '../helpers/fakeConfigStore.js';
import { IDENTITY, IEEE, makeDevice, recordingLink, type Sent } from '../core/helpers.js';
import { makeRule } from './helpers.js';

const tick = () => new Promise<void>((r) => setImmediate(r));
const settle = async (n = 5) => {
  for (let i = 0; i < n; i++) await tick();
};

const DEV = newId('dev');
const set = (value: boolean, deviceId = DEV): Action => ({ type: 'setProperty', deviceId, property: 'state', value });

function makeScene(actions: Action[], over: Partial<Scene> = {}): Scene {
  return Scene.parse({ id: newId('scn'), siteId: IDENTITY.siteId, hubId: IDENTITY.hubId, name: 'Scene', actions, rev: 1, updatedAt: 1, ...over });
}

function setup(opts: { outcome?: (deviceId: string, payload: unknown) => SetOutcome } = {}) {
  const time = new FakeTime(1_000_000);
  const runs: RunProgress[] = [];
  const events: any[] = [];
  const results: Array<[RunSource, string, number]> = [];
  const rules = new Map<string, Rule>();
  const scenes = new Map<string, Scene>();
  const setQueue = { handle: vi.fn(async (d: string, p: unknown) => opts.outcome?.(d, p) ?? ({ ok: true, confirmed: true } as SetOutcome)) };
  const runner = new ActionRunner({
    publisher: { publishHub: (_k, body) => runs.push(RunProgress.parse({ v: 1, ts: time.now(), seq: runs.length + 1, ...body })) },
    events: { emit: (b) => events.push(b) },
    setQueue,
    getScene: (id) => scenes.get(id),
    getRule: (id) => rules.get(id),
    onResult: (s, r, at) => results.push([s, r, at]),
    clock: time,
    timers: time,
    defer: (fn) => fn(),
  });
  return { time, runs, events, results, rules, scenes, setQueue, runner };
}

const statuses = (runs: RunProgress[]) => runs.map((r) => `${r.status}:${r.steps.map((s) => s.status[0]).join('')}`);

describe('ActionRunner (FR-H08, data-model §3.5)', () => {
  it('runs actions in order and publishes RunProgress on every step change', async () => {
    const s = setup();
    const rule = makeRule({ trigger: { type: 'schedule', at: '07:00' }, actions: [set(true), { type: 'notify', title: 'Đã bật', level: 'info' }, set(false)] });
    s.rules.set(rule.id, rule);
    const h = s.runner.runRule(rule)!;
    expect(h.runId).toMatch(/^run_/);
    expect(await h.done).toBe('ok');
    expect(statuses(s.runs)).toEqual(['running:rpp', 'running:orp', 'running:oor', 'ok:ooo']);
    expect(s.runs.every((r) => r.runId === h.runId && r.total === 3 && r.source.kind === 'rule')).toBe(true);
    expect(s.setQueue.handle.mock.calls.map((c) => c[1])).toEqual([{ values: { state: true } }, { values: { state: false } }]);
    expect(s.events).toEqual([
      { type: 'notify', title: 'Đã bật', level: 'info', ruleId: rule.id },
      { type: 'rule.fired', ruleId: rule.id, runId: h.runId, result: 'ok' },
    ]);
    expect(s.results).toEqual([[{ kind: 'rule', ruleId: rule.id }, 'ok', 1_000_000]]);
  });

  it('a running rule is not started twice', async () => {
    const s = setup();
    const rule = makeRule({ trigger: { type: 'schedule', at: '07:00' }, actions: [{ type: 'delay', seconds: 5 }] });
    s.rules.set(rule.id, rule);
    const h = s.runner.runRule(rule)!;
    expect(s.runner.runRule(rule)).toBeNull();
    s.time.advance(5_000);
    expect(await h.done).toBe('ok');
    expect(s.runner.runRule(rule)).not.toBeNull();
  });

  it('delay is cancelled when the rule rev changes mid-run → cancelled, remaining steps skipped', async () => {
    const s = setup();
    const rule = makeRule({ trigger: { type: 'schedule', at: '07:00' }, actions: [set(true), { type: 'delay', seconds: 60 }, set(false)] });
    s.rules.set(rule.id, rule);
    const h = s.runner.runRule(rule)!;
    await settle();
    expect(s.time.pending()).toBe(1); // delay timer armed
    s.time.advance(30_000);
    s.rules.set(rule.id, { ...rule, rev: 2 });
    s.runner.rulesChanged();
    expect(await h.done).toBe('cancelled');
    expect(s.time.pending()).toBe(0);
    expect(s.setQueue.handle).toHaveBeenCalledTimes(1);
    expect(statuses(s.runs).at(-1)).toBe('cancelled:oss');
    expect(s.events.some((e) => e.type === 'rule.fired')).toBe(false);
    expect(s.results).toHaveLength(0);
  });

  it('enabled=false mid-run → cancelled', async () => {
    const s = setup();
    const rule = makeRule({ trigger: { type: 'schedule', at: '07:00' }, actions: [{ type: 'delay', seconds: 10 }, set(true)] });
    s.rules.set(rule.id, rule);
    const h = s.runner.runRule(rule)!;
    await settle();
    s.rules.set(rule.id, { ...rule, enabled: false });
    s.runner.rulesChanged();
    expect(await h.done).toBe('cancelled');
    expect(s.setQueue.handle).not.toHaveBeenCalled();
  });

  it('partial failure keeps going; all failing → failed', async () => {
    const bad = newId('dev');
    const s = setup({ outcome: (d) => (d === bad ? { ok: false, reason: 'device_offline' } : { ok: true, confirmed: true }) });
    const scene = makeScene([set(true), set(true, bad), { type: 'delay', seconds: 1 }, set(false)]);
    s.scenes.set(scene.id, scene);
    const h = s.runner.runScene(scene.id)!;
    await settle();
    s.time.advance(1_000);
    expect(await h.done).toBe('partial');
    const last = s.runs.at(-1)!;
    expect(last.steps.map((x) => x.status)).toEqual(['ok', 'failed', 'ok', 'ok']);
    expect(last.steps[1]!.error).toBe('device_offline');
    expect(s.events.at(-1)).toEqual({ type: 'scene.run', sceneId: scene.id, runId: h.runId, result: 'partial' });

    const all = makeScene([set(true, bad), { type: 'delay', seconds: 1 }]);
    s.scenes.set(all.id, all);
    const h2 = s.runner.runScene(all.id)!;
    await settle();
    s.time.advance(1_000);
    expect(await h2.done).toBe('failed');
  });

  it('unconfirmed set → step failed not_confirmed', async () => {
    const s = setup({ outcome: () => ({ ok: true, confirmed: false }) });
    const h = s.runner.runTest([set(true)]);
    expect(await h.done).toBe('failed');
    expect(s.runs.at(-1)!.steps[0]!.error).toBe('not_confirmed');
    expect(s.runs[0]!.source).toEqual({ kind: 'test' });
    expect(s.results).toHaveLength(0); // test runs never touch lastRunAt
  });

  it('runScene: one level only', async () => {
    const s = setup();
    const inner = makeScene([set(false)]);
    const middle = makeScene([set(true), { type: 'runScene', sceneId: inner.id }]);
    for (const x of [inner, middle]) s.scenes.set(x.id, x);

    // scene.run(middle) → inner runs (level 1)
    expect(await s.runner.runScene(middle.id)!.done).toBe('ok');
    expect(s.setQueue.handle).toHaveBeenCalledTimes(2);

    // rule → middle (level 1) → inner refused (level 2)
    s.setQueue.handle.mockClear();
    const rule = makeRule({ trigger: { type: 'schedule', at: '07:00' }, actions: [{ type: 'runScene', sceneId: middle.id }] });
    s.rules.set(rule.id, rule);
    expect(await s.runner.runRule(rule)!.done).toBe('failed');
    expect(s.setQueue.handle).toHaveBeenCalledTimes(1);
    expect(s.runs.at(-1)!.steps[0]!.error).toBe('scene_partial:scene_nesting_too_deep');

    expect(s.runner.runScene(newId('scn'))).toBeNull();
  });
});

function fakeDriver() {
  return {
    id: 'zigbee2mqtt' as const,
    start: vi.fn(async () => {}),
    stop: vi.fn(async () => {}),
    onDeviceDiscovered: vi.fn(),
    onState: vi.fn(),
    onAvailability: vi.fn(),
    setProperty: vi.fn(async () => {}),
    startPairing: vi.fn(async (_s: number) => {}),
    stopPairing: vi.fn(async () => {}),
    removeDevice: vi.fn(async () => {}),
    rename: vi.fn(async (_e: string, _n: string) => {}),
    ping: vi.fn(async () => {}),
    buildProperties,
    toDriverValue,
    fromDriverValue,
  } satisfies Driver;
}

describe('scene.run / actions.test handlers', () => {
  const env = (cmd: unknown, id = newId('cmd')) => JSON.stringify({ v: 1, id, sentAt: 1, cmd });

  it('ack {runId} first, then runs with the same runId; invalid actions → ack invalid; unknown scene → not_found', async () => {
    const sent: Sent[] = [];
    const cs = new FakeConfigStore();
    const core = createHubCore({ driver: fakeDriver(), configStore: () => cs, guardMs: 500 });
    core.publisher.addLink('local', recordingLink('local', sent));
    core.setIdentity(IDENTITY);
    const t = (k: 'ack' | 'runs') => (k === 'ack' ? topics.ack(IDENTITY.tenantId, IDENTITY.hubId) : topics.runs(IDENTITY.tenantId, IDENTITY.hubId));

    const ack = await core.commands.handle(env({ type: 'actions.test', actions: [{ type: 'notify', title: 'Thử', level: 'info' }] }), 'lan');
    expect(ack).toMatchObject({ ok: true });
    const runId = (ack as CommandAck).result!.runId as string;
    await settle();
    const runs = sent.filter((x) => x.topic === t('runs')).map((x) => RunProgress.parse(x.json));
    expect(runs.map((r) => r.status)).toEqual(['running', 'ok']);
    expect(runs.every((r) => r.runId === runId && r.source.kind === 'test')).toBe(true);
    const firstRun = sent.findIndex((x) => x.topic === t('runs'));
    const ackIdx = sent.findIndex((x) => x.topic === t('ack'));
    expect(ackIdx).toBeLessThan(firstRun);

    expect(await core.commands.handle(env({ type: 'actions.test', actions: [{ type: 'delay', seconds: 0 }] }), 'lan')).toMatchObject({ ok: false, error: 'invalid' });
    expect(await core.commands.handle(env({ type: 'scene.run', sceneId: newId('scn') }), 'lan')).toMatchObject({ ok: false, error: 'not_found' });

    // scene known through the rules/scenes listener
    const scene = makeScene([{ type: 'notify', title: 'x', level: 'info' }]);
    cs.setScene(scene);
    core.automation.sync.attach(cs);
    const a2 = await core.commands.handle(env({ type: 'scene.run', sceneId: scene.id }), 'lan');
    expect(a2).toMatchObject({ ok: true, result: { runId: expect.stringMatching(/^run_/) } });
    core.stop();
  });

  it('property rule fires through the engine and runs via the set queue', async () => {
    const sent: Sent[] = [];
    const cs = new FakeConfigStore();
    const driver = fakeDriver();
    const core = createHubCore({ driver, configStore: () => cs, confirmTimeoutMs: 50 });
    core.publisher.addLink('local', recordingLink('local', sent));
    core.setIdentity(IDENTITY);
    const dev = makeDevice();
    core.registry.insert(dev, { friendlyName: IEEE, online: true });
    core.registry.applyState(dev.id, { power: 10, state: 'OFF' }, (p, r) => fromDriverValue(p, r));
    const rule = makeRule({
      trigger: { type: 'property', deviceId: dev.id, property: 'power', op: 'lt', value: 5 },
      actions: [{ type: 'setProperty', deviceId: dev.id, property: 'state', value: true }],
    });
    cs.setRule(rule);
    core.automation.sync.attach(cs);
    await settle();
    expect(cs.rules.get(rule.id)!.appliedRev).toBe(1);
    core.registry.applyState(dev.id, { power: 3 }, (p, r) => fromDriverValue(p, r));
    await new Promise((r) => setTimeout(r, 120));
    expect(driver.setProperty).toHaveBeenCalledTimes(1);
    expect(driver.setProperty.mock.calls[0]![1]).toBe('state');
    core.stop();
  });
});

describe('ConfigApply + RuleSync (data-model §3.4)', () => {
  function stack(batch = false) {
    const time = new FakeTime(5_000_000);
    const cs = new FakeConfigStore();
    const batches: unknown[][] = [];
    if (batch) {
      (cs as any).batchHubFields = async (w: any[]) => {
        batches.push(w);
        for (const x of w) await (x.kind === 'rule' ? cs.updateRuleHubFields(x.id, x.patch) : cs.updateSceneHubFields(x.id, x.patch));
      };
    }
    const events: any[] = [];
    const store = openStore(':memory:');
    const apply = new ConfigApply({ configStore: () => cs, events: { emit: (b) => events.push(b) }, db: store.db, clock: time, timers: time });
    const loads: Rule[][] = [];
    const runner = { rulesChanged: vi.fn() };
    const lifecycle = { setRulesAndScenes: vi.fn() };
    const sync = new RuleSync({ engine: { load: (r) => loads.push(r), setSite: vi.fn() }, runner, apply, lifecycle, lookup: () => undefined });
    return { time, cs, batches, events, store, apply, sync, loads, runner, lifecycle };
  }

  it('writes appliedRev = rev after load in one batch and emits config.applied once', async () => {
    const s = stack(true);
    const r1 = makeRule({ trigger: { type: 'schedule', at: '07:00' }, rev: 3 });
    const r2 = makeRule({ trigger: { type: 'schedule', at: '08:00' }, rev: 1, appliedRev: 1 });
    s.cs.setRule(r1);
    s.cs.setRule(r2);
    s.sync.attach(s.cs);
    await settle();
    expect(s.batches).toHaveLength(1);
    expect(s.batches[0]).toEqual([{ kind: 'rule', id: r1.id, patch: { appliedRev: 3 } }]);
    expect(s.cs.rules.get(r1.id)!.appliedRev).toBe(3);
    expect(s.events).toEqual([{ type: 'config.applied', ruleIds: [r1.id], sceneIds: [], rev: 3 }]);
    expect(s.loads.length).toBeGreaterThan(0);
    expect(s.runner.rulesChanged).toHaveBeenCalled();
    expect(s.lifecycle.setRulesAndScenes).toHaveBeenCalled();

    // app saves rev 4 → one more write; our own appliedRev echo does not loop
    s.cs.setRule({ ...s.cs.rules.get(r1.id)!, rev: 4 });
    await settle();
    expect(s.batches).toHaveLength(2);
    expect(s.cs.rules.get(r1.id)!.appliedRev).toBe(4);
    expect(s.events).toHaveLength(2);
  });

  it('scene referencing an unknown device → broken in the same batch', async () => {
    const s = stack(true);
    const sc = makeScene([set(true)]);
    s.cs.setScene(sc);
    s.sync.attach(s.cs);
    await settle();
    expect(s.cs.scenes.get(sc.id)).toMatchObject({ appliedRev: 1, lastResult: 'broken', brokenReason: `device_removed:${DEV}` });
  });

  it('lastRunAt/lastResult: ≤ 1 write / 10 s per rule, latest value wins, persisted in rule_state', async () => {
    const s = stack();
    const r = makeRule({ trigger: { type: 'schedule', at: '07:00' }, appliedRev: 1 });
    s.cs.setRule(r);
    const src = { kind: 'rule' as const, ruleId: r.id };
    s.apply.recordResult(src, 'ok', s.time.now());
    await settle();
    s.time.advance(2_000);
    s.apply.recordResult(src, 'partial', s.time.now());
    s.time.advance(1_000);
    s.apply.recordResult(src, 'failed', s.time.now());
    const writes = () => s.cs.writes.filter((w) => w[0] === 'updateRuleHubFields');
    expect(writes()).toHaveLength(1);
    const row = s.store.db.prepare('SELECT * FROM rule_state WHERE rule_id = ?').get(r.id)!;
    expect(row).toMatchObject({ last_result: 'failed', pending_write: 1 });
    s.time.advance(7_000);
    await settle();
    expect(writes()).toHaveLength(2);
    expect(writes()[1]![2]).toEqual({ lastRunAt: 5_003_000, lastResult: 'failed' });
    expect(s.store.db.prepare('SELECT pending_write FROM rule_state WHERE rule_id = ?').get(r.id)).toMatchObject({ pending_write: 0 });
  });

  it('boots from config_snapshot (offline) and pending rule_state rows are flushed on sign-in', async () => {
    const s = stack();
    const r = makeRule({ trigger: { type: 'schedule', at: '07:00' } });
    s.store.snapshot.put('rules', [r], 1);
    s.store.db.prepare('INSERT INTO rule_state (rule_id, last_run_at, last_result, pending_write) VALUES (?, ?, ?, 1)').run(r.id, 42, 'ok');
    s.sync.loadSnapshot(s.store.snapshot);
    expect(s.loads.at(-1)).toEqual([r]);
    const apply2 = new ConfigApply({ configStore: () => s.cs, events: { emit: () => {} }, db: s.store.db, clock: s.time, timers: s.time });
    s.cs.setRule(r);
    await apply2.flushAll();
    expect(s.cs.rules.get(r.id)).toMatchObject({ lastRunAt: 42, lastResult: 'ok' });
  });
});
