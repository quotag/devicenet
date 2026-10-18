import mqtt from 'mqtt';
import { afterEach, describe, expect, it } from 'vitest';
import { startEmbeddedBroker, type EmbeddedBroker } from '../../src/supervisor/embeddedBroker.js';

let b: EmbeddedBroker | undefined;
afterEach(async () => {
  await b?.close();
  b = undefined;
});
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('embedded broker', () => {
  it('ws anonymous: read t/#, write only set/cmd; z2m confined', async () => {
    b = await startEmbeddedBroker({ port: 0, wsPort: 0, wsHost: '127.0.0.1' });
    const hub = mqtt.connect(`mqtt://127.0.0.1:${b.port}`, { username: 'hub', password: 'x' });
    const ws = mqtt.connect(`ws://127.0.0.1:${b.wsPort}`);
    await Promise.all([new Promise((r) => hub.once('connect', r)), new Promise((r) => ws.once('connect', r))]);
    const got: string[] = [];
    ws.on('message', (t, buf) => got.push(`${t}=${buf.toString()}`));
    await new Promise((r) => ws.subscribe(['t/#', 'zigbee2mqtt/#'], r));
    const hubGot: string[] = [];
    hub.on('message', (t) => hubGot.push(t));
    await new Promise((r) => hub.subscribe('#', r));

    hub.publish('t/ten/h/hub/d/dev/state', '1');
    hub.publish('zigbee2mqtt/x', '1');
    ws.publish('t/ten/h/hub/d/dev/set', '1');
    ws.publish('t/ten/h/hub/cmd', '1');
    ws.publish('t/ten/h/hub/d/dev/state', 'evil');
    ws.publish('zigbee2mqtt/x/set', 'evil');
    await wait(400);
    expect(got.sort()).toEqual(['t/ten/h/hub/cmd=1', 't/ten/h/hub/d/dev/set=1', 't/ten/h/hub/d/dev/state=1']);
    expect(hubGot).toContain('t/ten/h/hub/d/dev/set');
    expect(hubGot).toContain('t/ten/h/hub/cmd');
    expect(hubGot).not.toContain('zigbee2mqtt/x/set');
    expect(hubGot.filter((t) => t === 't/ten/h/hub/d/dev/state')).toHaveLength(1);
    hub.end(true);
    ws.end(true);
  });
});
