import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildProperties } from '../../src/drivers/zigbee2mqtt/exposes.js';
import { fromDriverValue, toDriverValue } from '../../src/drivers/zigbee2mqtt/values.js';

const device = JSON.parse(readFileSync(new URL('../fixtures/ts011f.device.json', import.meta.url), 'utf8'));
const p = buildProperties(device.definition.exposes);

describe('values', () => {
  it('binary <-> ON/OFF', () => {
    expect(toDriverValue(p.state!, true)).toBe('ON');
    expect(toDriverValue(p.state!, false)).toBe('OFF');
    expect(fromDriverValue(p.state!, 'ON')).toBe(true);
    expect(fromDriverValue(p.state!, 'OFF')).toBe(false);
  });
  it('binary honours value_on/value_off (child_lock)', () => {
    expect(toDriverValue(p.child_lock!, true)).toBe('LOCK');
    expect(fromDriverValue(p.child_lock!, 'UNLOCK')).toBe(false);
  });
  it('numeric and enum pass through', () => {
    expect(toDriverValue(p.power!, 12.4)).toBe(12.4);
    expect(fromDriverValue(p.power!, 12.4)).toBe(12.4);
    expect(toDriverValue(p.power_on_behavior!, 'previous')).toBe('previous');
    expect(fromDriverValue(p.indicator_mode!, 'off/on')).toBe('off/on');
  });
});
