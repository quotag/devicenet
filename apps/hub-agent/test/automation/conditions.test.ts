import { describe, expect, it } from 'vitest';
import type { ConditionGroup, PropertyValue } from '@devicenet/shared';
import { compare, compileConditions, defaultSunTimes, inTimeWindow, localParts, type ConditionContext } from '../../src/automation/conditions.js';
import { newId } from '../../src/core/ids.js';
import { TZ } from './helpers.js';

/** UTC ms for a wall-clock time in Asia/Ho_Chi_Minh (UTC+7, no DST). */
const vn = (y: number, mo: number, d: number, h: number, mi = 0) => Date.UTC(y, mo - 1, d, h - 7, mi);

const DEV = newId('dev');
const ctx = (now: number, values: Record<string, PropertyValue> = {}, extra: Partial<ConditionContext> = {}): ConditionContext => ({
  now,
  site: { timezone: TZ, lat: 10.8231, lng: 106.6297 },
  getValue: (d, p) => (d === DEV ? values[p] : undefined),
  ...extra,
});
const run = (g: ConditionGroup, cx: ConditionContext) => compileConditions(g)(cx);

describe('conditions', () => {
  it('compare ops', () => {
    expect(compare('eq', true, true)).toBe(true);
    expect(compare('neq', 'a', 'b')).toBe(true);
    expect(compare('lt', 4, 5)).toBe(true);
    expect(compare('lte', 5, 5)).toBe(true);
    expect(compare('gt', 5, 5)).toBe(false);
    expect(compare('gte', 5, 5)).toBe(true);
    expect(compare('lt', '4' as never, 5)).toBe(false);
    expect(compare('neq', undefined, 1)).toBe(false);
  });

  it('localParts in site tz', () => {
    // 2026-10-18 is a Sunday; 23:30 VN = 16:30 UTC
    expect(localParts(vn(2026, 10, 18, 23, 30), TZ)).toEqual({ minutes: 23 * 60 + 30, day: 0 });
    // 00:15 VN Monday is still Sunday in UTC
    expect(localParts(vn(2026, 10, 19, 0, 15), TZ)).toEqual({ minutes: 15, day: 1 });
  });

  it('overnight window 22:00–06:00 Asia/Ho_Chi_Minh', () => {
    const g: ConditionGroup = { all: [{ type: 'timeWindow', from: '22:00', to: '06:00' }] };
    expect(run(g, ctx(vn(2026, 10, 18, 21, 59)))).toBe(false);
    expect(run(g, ctx(vn(2026, 10, 18, 22, 0)))).toBe(true);
    expect(run(g, ctx(vn(2026, 10, 18, 23, 59)))).toBe(true);
    expect(run(g, ctx(vn(2026, 10, 19, 0, 0)))).toBe(true);
    expect(run(g, ctx(vn(2026, 10, 19, 5, 59)))).toBe(true);
    expect(run(g, ctx(vn(2026, 10, 19, 6, 0)))).toBe(false);
    expect(run(g, ctx(vn(2026, 10, 19, 12, 0)))).toBe(false);
  });

  it('daytime window and from==to', () => {
    expect(inTimeWindow(8 * 60, '08:00', '17:00')).toBe(true);
    expect(inTimeWindow(17 * 60, '08:00', '17:00')).toBe(false);
    expect(inTimeWindow(3, '10:00', '10:00')).toBe(true);
  });

  it('dayOfWeek in site tz (not UTC)', () => {
    const g: ConditionGroup = { all: [{ type: 'dayOfWeek', days: [1] }] };
    expect(run(g, ctx(vn(2026, 10, 19, 0, 15)))).toBe(true); // Monday VN, Sunday UTC
    expect(run(g, ctx(vn(2026, 10, 18, 23, 0)))).toBe(false);
  });

  it('property condition', () => {
    const g: ConditionGroup = { all: [{ type: 'property', deviceId: DEV, property: 'state', op: 'eq', value: true }] };
    expect(run(g, ctx(0, { state: true }))).toBe(true);
    expect(run(g, ctx(0, { state: false }))).toBe(false);
    expect(run(g, ctx(0, {}))).toBe(false);
  });

  it('all/any with one nesting level', () => {
    const on = { type: 'property', deviceId: DEV, property: 'state', op: 'eq', value: true } as const;
    const night = { type: 'timeWindow', from: '22:00', to: '06:00' } as const;
    const sunday = { type: 'dayOfWeek', days: [0] } as const;
    const g: ConditionGroup = { all: [on, { any: [night, sunday] }] };
    expect(run(g, ctx(vn(2026, 10, 18, 12), { state: true }))).toBe(true); // Sunday noon
    expect(run(g, ctx(vn(2026, 10, 19, 12), { state: true }))).toBe(false); // Monday noon
    expect(run(g, ctx(vn(2026, 10, 19, 23), { state: true }))).toBe(true); // Monday night
    expect(run(g, ctx(vn(2026, 10, 19, 23), { state: false }))).toBe(false);
    const g2: ConditionGroup = { any: [{ all: [on, sunday] }, night] };
    expect(run(g2, ctx(vn(2026, 10, 18, 12), { state: true }))).toBe(true);
    expect(run(g2, ctx(vn(2026, 10, 18, 12), { state: false }))).toBe(false);
    expect(run(g2, ctx(vn(2026, 10, 19, 23), {}))).toBe(true);
  });

  it('sun: current time vs today sun times (injected)', () => {
    const sunTimes = () => ({ sunrise: vn(2026, 10, 18, 5, 45), sunset: vn(2026, 10, 18, 17, 30) });
    const after = (when: 'afterSunrise' | 'afterSunset', offsetMin = 0): ConditionGroup => ({ all: [{ type: 'sun', when, offsetMin }] });
    const at = (h: number, m = 0) => ctx(vn(2026, 10, 18, h, m), {}, { sunTimes });
    expect(run(after('afterSunset'), at(17, 29))).toBe(false);
    expect(run(after('afterSunset'), at(17, 30))).toBe(true);
    expect(run(after('afterSunset'), at(23))).toBe(true);
    expect(run(after('afterSunset'), at(4))).toBe(true); // before sunrise
    expect(run(after('afterSunset'), at(12))).toBe(false);
    expect(run(after('afterSunset', 30), at(17, 45))).toBe(false);
    expect(run(after('afterSunset', 30), at(18, 0))).toBe(true);
    expect(run(after('afterSunrise'), at(5, 44))).toBe(false);
    expect(run(after('afterSunrise'), at(5, 45))).toBe(true);
    expect(run(after('afterSunrise'), at(17, 30))).toBe(false);
    expect(run(after('afterSunrise', -15), at(5, 31))).toBe(true);
  });

  it('sun: default suncalc times for Ho Chi Minh City; missing coords → false', () => {
    const st = defaultSunTimes(vn(2026, 10, 18, 23), { timezone: TZ, lat: 10.8231, lng: 106.6297 })!;
    const rise = localParts(st.sunrise, TZ).minutes;
    const set = localParts(st.sunset, TZ).minutes;
    expect(rise).toBeGreaterThan(5 * 60 + 30);
    expect(rise).toBeLessThan(6 * 60);
    expect(set).toBeGreaterThan(17 * 60 + 15);
    expect(set).toBeLessThan(17 * 60 + 45);
    // same solar day early morning and late evening
    const early = defaultSunTimes(vn(2026, 10, 18, 0, 30), { timezone: TZ, lat: 10.8231, lng: 106.6297 })!;
    expect(Math.abs(early.sunrise - st.sunrise)).toBeLessThan(60_000);
    const g: ConditionGroup = { all: [{ type: 'sun', when: 'afterSunset', offsetMin: 0 }] };
    expect(run(g, ctx(vn(2026, 10, 18, 23), {}, { site: { timezone: TZ } }))).toBe(false);
    expect(run(g, ctx(vn(2026, 10, 18, 23)))).toBe(true);
  });
});
