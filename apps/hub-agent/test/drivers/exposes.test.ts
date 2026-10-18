import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { PropertyMap } from '@devicenet/shared';
import { buildProperties } from '../../src/drivers/zigbee2mqtt/exposes.js';

const device = JSON.parse(readFileSync(new URL('../fixtures/ts011f.device.json', import.meta.url), 'utf8'));

describe('buildProperties (TS011F)', () => {
  const props = buildProperties(device.definition.exposes);

  it('produces the exact PropertyMap', () => {
    expect(props).toEqual({
      state: { key: 'state', type: 'binary', label: 'Trạng thái', access: 'rw', category: 'control', driverMeta: { z2m: 'state', valueOn: 'ON', valueOff: 'OFF' } },
      power: { key: 'power', type: 'numeric', label: 'Công suất', access: 'r', category: 'sensor', unit: 'W', precision: 1, driverMeta: { z2m: 'power' } },
      voltage: { key: 'voltage', type: 'numeric', label: 'Điện áp', access: 'r', category: 'sensor', unit: 'V', precision: 0, driverMeta: { z2m: 'voltage' } },
      current: { key: 'current', type: 'numeric', label: 'Dòng điện', access: 'r', category: 'sensor', unit: 'A', precision: 2, driverMeta: { z2m: 'current' } },
      energy: { key: 'energy', type: 'numeric', label: 'Điện năng', access: 'r', category: 'sensor', unit: 'kWh', precision: 1, driverMeta: { z2m: 'energy' } },
      power_on_behavior: {
        key: 'power_on_behavior', type: 'enum', label: 'Khi có điện lại', access: 'rw', category: 'config',
        values: ['off', 'on', 'previous'], valueLabels: { off: 'Tắt', on: 'Bật', previous: 'Nhớ' }, driverMeta: { z2m: 'power_on_behavior' },
      },
      indicator_mode: {
        key: 'indicator_mode', type: 'enum', label: 'Đèn báo', access: 'rw', category: 'control',
        values: ['off', 'off/on', 'on/off', 'on'],
        valueLabels: { off: 'Tắt', 'off/on': 'Sáng khi tắt', 'on/off': 'Sáng khi bật', on: 'Bật' },
        driverMeta: { z2m: 'indicator_mode' },
      },
      child_lock: { key: 'child_lock', type: 'binary', label: 'Khóa trẻ em', access: 'rw', category: 'config', driverMeta: { z2m: 'child_lock', valueOn: 'LOCK', valueOff: 'UNLOCK' } },
      linkquality: { key: 'linkquality', type: 'numeric', label: 'Chất lượng sóng', access: 'r', category: 'diag', min: 0, max: 255, driverMeta: { z2m: 'linkquality' } },
    });
  });

  it('validates against the shared PropertyMap schema', () => {
    expect(PropertyMap.safeParse(props).success).toBe(true);
  });

  it('keeps snake_case keys and ignores unknown/empty exposes', () => {
    expect(Object.keys(props)).toContain('power_on_behavior');
    expect(buildProperties([{ type: 'weird' }, null, { type: 'enum', name: 'x', access: 1, values: [] }])).toEqual({});
  });
});
