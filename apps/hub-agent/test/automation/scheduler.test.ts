import { describe, expect, it } from 'vitest';
import type { Rule } from '@devicenet/shared';
import { FakeTime } from '../../src/core/clock.js';
import { compileRule, type CompiledRule } from '../../src/automation/compile.js';
import { AutomationEngine } from '../../src/automation/engine.js';
import type { SiteInfo } from '../../src/automation/conditions.js';
import { lastScheduleFireIn, MAX_TIMEOUT_MS, Scheduler, type ScheduledFire } from '../../src/automation/scheduler.js';
import { localNoon, nextSunFire, nextSunRecompute, sunEventAt } from '../../src/automation/sun.js';
import { makeRule, plugRegistry, TZ } from './helpers.js';

const H = 3600_000;
const M = 60_000;
/** UTC ms for a wall-clock time in Asia/Ho_Chi_Minh (UTC+7, no DST) */
const vn = (y: number, mo: number, d: number, h: number, mi = 0, s = 0) => Date.UTC(y, mo - 1, d, h - 7, mi, s);
const fmt = (ms: number) => new Date(ms).toLocaleString('sv-SE', { timeZone: TZ }).slice(0, 16);

const HCMC: SiteInfo = { timezone: TZ, lat: 10.7769, lng: 106.7009 };
const compile = (r: Rule, site: SiteInfo | null = HCMC): CompiledRule => {
  const res = compileRule(r, () => undefined, site);
  if (!res.ok) throw new Error(res.reason);
  return res.compiled;
};

function setup(start: number, extra: Partial<ConstructorParameters<typeof Scheduler>[0]> = {}) {
  const time = new FakeTime(start);
  const fires: ScheduledFire[] = [];
  const events: Array<{ type: string; code?: string; message?: string }> = [];
  const scheduler = new Scheduler({
    clock: time,
    timers: time,
    site: HCMC,
    onFire: (f) => fires.push(f),
    events: { emit: (b) => events.push(b as never) },
    ...extra,
  });
  return { time, fires, events, scheduler };
}

const sched = (at: string, days?: number[], over: Partial<Rule> = {}) =>
  makeRule({ trigger: { type: 'schedule', at, ...(days ? { days } : {}) }, ...over });

describe('Scheduler — schedule triggers in site timezone (constitution VI)', () => {
  it('fires at 23:00 Asia/Ho_Chi_Minh (16:00Z) every day, exactly once per day', () => {
    // Sun 2026-10-18 10:00 local
    const s = setup(vn(2026, 10, 18, 10));
    const r = sched('23:00');
    s.scheduler.load([compile(r)]);
    expect(s.scheduler.nextFireAt(r.id)).toBe(Date.UTC(2026, 9, 18, 16, 0));
    s.time.advance(13 * H - 1);
    expect(s.fires).toHaveLength(0);
    s.time.advance(1);
    expect(s.fires).toHaveLength(1);
    expect(fmt(s.fires[0]!.at)).toBe('2026-10-18 23:00');
    expect(s.fires[0]!.trigger).toEqual({ type: 'schedule', at: '23:00' });
    s.time.advance(3 * 24 * H);
    expect(s.fires.map((f) => fmt(f.at))).toEqual(['2026-10-18 23:00', '2026-10-19 23:00', '2026-10-20 23:00', '2026-10-21 23:00']);
  });

  it('days filter: Mon/Wed/Fri only (0 = Sunday)', () => {
    const s = setup(vn(2026, 10, 18, 0)); // Sunday
    s.scheduler.load([compile(sched('06:30', [1, 3, 5]))]);
    s.time.advance(7 * 24 * H);
    expect(s.fires.map((f) => fmt(f.at))).toEqual(['2026-10-19 06:30', '2026-10-21 06:30', '2026-10-23 06:30']);
  });

  it('conditions are evaluated at fire time; failing conditions do not fire', () => {
    const s = setup(vn(2026, 10, 18, 0));
    const r = sched('07:00', undefined, { conditions: { all: [{ type: 'dayOfWeek', days: [6] }] } }); // Saturday only
    s.scheduler.load([compile(r)]);
    s.time.advance(7 * 24 * H);
    expect(s.fires.map((f) => fmt(f.at))).toEqual(['2026-10-24 07:00']);
  });

  it('reschedules on rule change (rev) and on site timezone change; disabled/removed rules stop', () => {
    const s = setup(vn(2026, 10, 18, 10));
    const r1 = sched('12:00');
    s.scheduler.load([compile(r1)]);
    const r2 = { ...r1, rev: 2, trigger: { type: 'schedule', at: '11:00' } } as Rule;
    s.scheduler.load([compile(r2)]);
    s.time.advance(1 * H);
    expect(s.fires.map((f) => fmt(f.at))).toEqual(['2026-10-18 11:00']);

    // same rule, site moves to Asia/Tokyo (UTC+9): next 11:00 Tokyo = 02:00Z
    s.scheduler.setSite({ timezone: 'Asia/Tokyo' });
    expect(new Date(s.scheduler.nextFireAt(r2.id)!).toISOString()).toBe('2026-10-19T02:00:00.000Z');

    s.scheduler.load([compile({ ...r2, enabled: false })]);
    expect(s.scheduler.nextFireAt(r2.id)).toBeUndefined();
    expect(s.time.pending()).toBe(0);
    s.time.advance(2 * 24 * H);
    expect(s.fires).toHaveLength(1);
  });

  it('reloading the same rule at the fire minute does not fire twice', () => {
    const s = setup(vn(2026, 10, 18, 22, 59));
    const r = sched('23:00');
    s.scheduler.load([compile(r)]);
    s.time.advance(M);
    expect(s.fires).toHaveLength(1);
    s.scheduler.load([compile({ ...r, rev: 2 })]);
    s.time.advance(30_000);
    expect(s.fires).toHaveLength(1);
    expect(fmt(s.scheduler.nextFireAt(r.id)!)).toBe('2026-10-19 23:00');
  });

  it('syncs from the engine: only compiled schedule/sun rules, broken (no coords) sun rules excluded', () => {
    const time = new FakeTime(vn(2026, 10, 18, 10));
    const p = plugRegistry({ power: 1 });
    const engine = new AutomationEngine({ registry: p.registry, clock: time, timers: time, site: { timezone: TZ } });
    const sch = sched('12:00');
    const sun = makeRule({ trigger: { type: 'sun', event: 'sunset', offsetMin: 0 } });
    const prop = makeRule({ trigger: { type: 'property', deviceId: p.device.id, property: 'power', op: 'gt', value: 5 } });
    engine.load([sch, sun, prop]);
    expect(engine.brokenReason(sun.id)).toBe('site_missing_coordinates');
    const fires: ScheduledFire[] = [];
    const scheduler = new Scheduler({ clock: time, timers: time, site: { timezone: TZ }, onFire: (f) => fires.push(f) });
    scheduler.sync(engine);
    expect(scheduler.nextFireAt(sch.id)).toBeDefined();
    expect(scheduler.nextFireAt(sun.id)).toBeUndefined();
    expect(scheduler.nextFireAt(prop.id)).toBeUndefined();
    time.advance(2 * H);
    expect(fires.map((f) => f.rule.id)).toEqual([sch.id]);
  });
});

describe('Sun triggers (constitution VI)', () => {
  it('sun times for Ho Chi Minh City on 2026-10-18 within ±1 min of reference (05:43 / 17:35)', () => {
    const now = vn(2026, 10, 18, 0, 10);
    const rise = sunEventAt(now, HCMC, 'sunrise')!;
    const set = sunEventAt(now, HCMC, 'sunset')!;
    expect(Math.abs(rise - vn(2026, 10, 18, 5, 43))).toBeLessThanOrEqual(M);
    expect(Math.abs(set - vn(2026, 10, 18, 17, 35))).toBeLessThanOrEqual(M);
    // same local day regardless of hour
    expect(sunEventAt(vn(2026, 10, 18, 23, 50), HCMC, 'sunset')).toBe(set);
    expect(localNoon(vn(2026, 10, 18, 23, 50), TZ)).toBe(vn(2026, 10, 18, 12));
  });

  it('offsetMin and next-day rollover', () => {
    const set = sunEventAt(vn(2026, 10, 18, 12), HCMC, 'sunset')!;
    expect(sunEventAt(vn(2026, 10, 18, 12), HCMC, 'sunset', -30)).toBe(set - 30 * M);
    const next = nextSunFire(vn(2026, 10, 18, 20), HCMC, 'sunset')!;
    expect(fmt(next).slice(0, 10)).toBe('2026-10-19');
    expect(fmt(nextSunRecompute(vn(2026, 10, 18, 20), TZ))).toBe('2026-10-19 00:05');
  });

  it('fires at sunset−15 min daily, recomputed at 00:05 site time', () => {
    const s = setup(vn(2026, 10, 18, 10));
    const r = makeRule({ trigger: { type: 'sun', event: 'sunset', offsetMin: -15 } });
    s.scheduler.load([compile(r)]);
    const expected1 = sunEventAt(vn(2026, 10, 18, 12), HCMC, 'sunset', -15)!;
    expect(s.scheduler.nextFireAt(r.id)).toBe(expected1);
    s.time.advance(expected1 - s.time.now());
    expect(s.fires).toHaveLength(1);
    expect(s.fires[0]!.trigger).toEqual({ type: 'sun', event: 'sunset', offsetMin: -15 });
    s.time.advance(2 * 24 * H);
    expect(s.fires.map((f) => fmt(f.scheduledAt).slice(0, 10))).toEqual(['2026-10-18', '2026-10-19', '2026-10-20']);
    const expected3 = sunEventAt(vn(2026, 10, 20, 12), HCMC, 'sunset', -15)!;
    expect(s.fires[2]!.scheduledAt).toBe(expected3);
    // recompute timer stays armed at the next 00:05
    expect(s.time.pending()).toBe(2);
  });

  it('missing coordinates: compile marks broken site_missing_coordinates; scheduler never arms it', () => {
    const r = makeRule({ trigger: { type: 'sun', event: 'sunrise', offsetMin: 0 } });
    const res = compileRule(r, () => undefined, { timezone: TZ });
    expect(res).toEqual({ ok: false, reason: 'site_missing_coordinates' });
    expect(sunEventAt(0, { timezone: TZ }, 'sunrise')).toBeNull();
    // a site losing its coordinates later → no timer
    const s = setup(vn(2026, 10, 18, 10));
    s.scheduler.load([compile(r)]);
    expect(s.scheduler.nextFireAt(r.id)).toBeDefined();
    s.scheduler.setSite({ timezone: TZ });
    expect(s.scheduler.nextFireAt(r.id)).toBeUndefined();
  });
});

describe('Missed schedule on boot (spec §8, OQ-6)', () => {
  it('reboot at 23:00:30 with a 23:00 rule → no catch-up, exactly one hub.warning schedule_missed', () => {
    const lastAliveAt = vn(2026, 10, 18, 22, 59, 50); // last heartbeat before power loss
    const s = setup(vn(2026, 10, 18, 23, 0, 30), { lastAliveAt });
    const r = sched('23:00', undefined, { updatedAt: vn(2026, 10, 1, 8) });
    s.scheduler.load([compile(r)]);
    expect(s.fires).toHaveLength(0);
    expect(s.events).toHaveLength(1);
    expect(s.events[0]).toMatchObject({ type: 'hub.warning', code: 'schedule_missed' });
    expect(s.events[0]!.message).toContain(r.id);
    // reload (rule sync) → no second warning
    s.scheduler.load([compile(r)]);
    s.time.advance(10 * M);
    expect(s.fires).toHaveLength(0);
    expect(s.events).toHaveLength(1);
    // next day runs normally
    s.time.advance(24 * H);
    expect(s.fires.map((f) => fmt(f.at))).toEqual(['2026-10-19 23:00']);
  });

  it('no warning when no expected fire fell in the downtime, or the rule was edited after it', () => {
    const s = setup(vn(2026, 10, 18, 23, 0, 30), { lastAliveAt: vn(2026, 10, 18, 22, 59, 50) });
    s.scheduler.load([
      compile(sched('22:00', undefined, { updatedAt: 1 })),
      compile(sched('23:00', [1], { updatedAt: 1 })), // Monday only; today is Sunday
      compile(sched('23:00', undefined, { updatedAt: vn(2026, 10, 18, 23, 0, 20) })),
    ]);
    expect(s.events).toHaveLength(0);
  });

  it('lastScheduleFireIn picks the last expected fire in (from, to]', () => {
    const t = { type: 'schedule' as const, at: '23:00' };
    expect(lastScheduleFireIn(t, TZ, vn(2026, 10, 15, 0), vn(2026, 10, 18, 23, 0))).toBe(vn(2026, 10, 18, 23, 0));
    expect(lastScheduleFireIn(t, TZ, vn(2026, 10, 18, 23, 0), vn(2026, 10, 18, 23, 30))).toBeNull();
  });

  it('chained timeout chunks delays > MAX_TIMEOUT_MS (24 days) safely', () => {
    const start = vn(2026, 1, 1, 0, 0);
    const s = setup(start);
    const r = sched('10:00');
    const c = compile(r);
    const targetTime = start + 60 * 86_400_000; // 60 days in future
    (s.scheduler as unknown as { nextFor: (e: unknown, after: number) => number | null }).nextFor = (_e, after) =>
      after < targetTime ? targetTime : null;
    s.scheduler.load([c]);

    // Should have a timer set for MAX_TIMEOUT_MS (24 days)
    expect(s.time.pending()).toBe(1);
    // Advance 24 days -> wakes up, remaining is 36 days (> 24 days), chains another 24 days
    s.time.advance(24 * 86_400_000);
    expect(s.fires).toHaveLength(0);
    expect(s.time.pending()).toBe(1);

    // Advance another 24 days -> wakes up, remaining is 12 days (<= 24 days), chains 12 days
    s.time.advance(24 * 86_400_000);
    expect(s.fires).toHaveLength(0);
    expect(s.time.pending()).toBe(1);

    // Advance remaining 12 days -> reaches targetTime, fires!
    s.time.advance(12 * 86_400_000);
    expect(s.fires).toHaveLength(1);
    expect(s.fires[0]!.at).toBe(targetTime);
  });
});

