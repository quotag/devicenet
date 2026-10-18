import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Device } from '@devicenet/shared';
import { buildProperties } from '../../src/drivers/zigbee2mqtt/exposes.js';
import { newId } from '../../src/core/ids.js';
import type { PublishLink, PublishOptions } from '../../src/core/publisher.js';

const fixtureDir = fileURLToPath(new URL('../fixtures/', import.meta.url));
export const fixtureDevice = JSON.parse(readFileSync(fixtureDir + 'ts011f.device.json', 'utf8'));
export const fixtureState = JSON.parse(readFileSync(fixtureDir + 'ts011f.state.json', 'utf8')) as Record<string, unknown>;
export const IEEE = fixtureDevice.ieee_address as string;

export const IDENTITY = {
  tenantId: newId('tenant'),
  hubId: newId('hub'),
  siteId: newId('site'),
};

export function makeDevice(over: Partial<Device> = {}): Device {
  return {
    id: newId('dev'),
    hubId: IDENTITY.hubId,
    siteId: IDENTITY.siteId,
    roomId: null,
    driver: 'zigbee2mqtt',
    externalId: IEEE,
    model: 'TS011F_plug_1',
    name: 'Ổ cắm',
    icon: 'plug',
    properties: buildProperties(fixtureDevice.definition.exposes),
    status: 'active',
    createdAt: 1,
    updatedAt: 1,
    ...over,
  };
}

export interface Sent {
  link: string;
  topic: string;
  payload: Buffer;
  json: any;
  opts: PublishOptions;
}

/** PublishLink that records everything it is asked to publish. */
export function recordingLink(name: string, into: Sent[]): PublishLink {
  return {
    publish(topic, payload, opts) {
      into.push({ link: name, topic, payload, json: payload.length ? JSON.parse(payload.toString('utf8')) : null, opts });
    },
  };
}

export const until = async (fn: () => boolean, ms = 3000): Promise<void> => {
  const t0 = Date.now();
  while (!fn()) {
    if (Date.now() - t0 > ms) throw new Error('until timed out');
    await new Promise((r) => setTimeout(r, 10));
  }
};
