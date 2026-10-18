import { Rule, type Device } from '@devicenet/shared';
import { newId } from '../../src/core/ids.js';
import { Registry } from '../../src/core/registry.js';
import { IDENTITY, makeDevice } from '../core/helpers.js';

export const TZ = 'Asia/Ho_Chi_Minh';

export function makeRule(over: Partial<Rule> & Pick<Rule, 'trigger'>): Rule {
  return Rule.parse({
    id: newId('rule'),
    siteId: IDENTITY.siteId,
    hubId: IDENTITY.hubId,
    name: 'Rule',
    enabled: true,
    actions: [{ type: 'notify', title: 'x' }],
    rev: 1,
    updatedAt: 1,
    ...over,
  });
}

/** Registry with one TS011F plug; `report(raw)` pushes a driver state report. */
export function plugRegistry(initial: Record<string, unknown> = {}, over: Partial<Device> = {}) {
  const registry = new Registry();
  const device = makeDevice(over);
  registry.insert(device);
  const report = (raw: Record<string, unknown>) => registry.applyState(device.id, raw, (_p, r) => r as never);
  if (Object.keys(initial).length) report(initial);
  return { registry, device, report };
}
