import { describe, expect, it } from 'vitest';
import type { HubEvent } from '@devicenet/shared';
import { FakeTime } from '../../src/core/clock.js';
import { newId } from '../../src/core/ids.js';
import { AutomationEngine } from '../../src/automation/engine.js';
import { openStore } from '../../src/store/index.js';
import { EventUploader } from '../../src/sync/eventUploader.js';
import { FakeConfigStore } from '../helpers/fakeConfigStore.js';
import { IDENTITY } from '../core/helpers.js';
import { makeRule, plugRegistry, TZ } from '../automation/helpers.js';

/** T119: 1 simulated hour without WAN (Firestore signed out) — local rules keep running; events upload exactly once afterwards. */
describe('WAN loss (cloud unreachable for 1 h)', () => {
  it('property rules still fire; events are uploaded once after reconnect', async () => {
    const time = new FakeTime(Date.UTC(2026, 9, 18, 3, 0));
    const db = openStore(':memory:');
    const cloud = new FakeConfigStore();
    cloud.setSignInState('signed-out'); // WAN down
    const uploader = new EventUploader({ store: () => cloud, repo: db.events });

    const p = plugRegistry({ power: 10 });
    let fired = 0;
    const engine = new AutomationEngine({
      registry: p.registry, clock: time, timers: time, site: { timezone: TZ },
      onFire: (f) => {
        fired++;
        const e = { v: 1, ts: f.at, seq: fired, id: newId('evt'), hubId: IDENTITY.hubId, type: 'rule.fired', ruleId: f.rule.id, runId: newId('run'), result: 'ok' } as unknown as HubEvent;
        db.events.insert(e);
        uploader.enqueue(e); // offline: no-op
      },
    });
    engine.attach();
    engine.load([makeRule({ trigger: { type: 'property', deviceId: p.device.id, property: 'power', op: 'lt', value: 5, for: 60 } })]);

    for (let i = 0; i < 6; i++) { // 6 cycles x 10 min = 1 h
      p.report({ power: 3 });
      time.advance(5 * 60_000);
      p.report({ power: 9 });
      time.advance(5 * 60_000);
    }
    expect(fired).toBe(6);
    expect(db.events.pendingUpload(100)).toHaveLength(6);
    expect(cloud.events.size).toBe(0);

    await new Promise((r) => setTimeout(r, 0)); // let the offline no-op flushes settle
    cloud.setSignInState('signed-in'); // WAN back
    expect(await uploader.flush()).toBe(6);
    expect(await uploader.flush()).toBe(0);
    expect(cloud.events.size).toBe(6);
    expect(cloud.writes.filter(([m]) => m === 'putEvent')).toHaveLength(6);
    db.close();
  });
});
