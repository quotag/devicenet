import { startBroker, type TestBroker } from '../helpers/brokers.js';
import { FakeConfigStore } from '../helpers/fakeConfigStore.js';
import { MockZ2m } from '../mock-z2m/index.js';
import { Zigbee2mqttDriver } from '../../src/drivers/zigbee2mqtt/driver.js';
import { createHubCore, type HubCore, type HubCoreOptions } from '../../src/core/hubCore.js';
import { openStore, type Store } from '../../src/store/index.js';
import { IDENTITY, recordingLink, type Sent } from './helpers.js';

export interface Stack {
  broker: TestBroker;
  mock: MockZ2m;
  driver: Zigbee2mqttDriver;
  core: HubCore;
  store: Store;
  cfg: FakeConfigStore;
  sent: Sent[];
  close(): Promise<void>;
}

/** aedes + mock Z2M + real driver + hub core (real timers), recording link for hub publishes. */
export async function startStack(
  opts: { withDevice?: boolean; claimed?: boolean; before?: (core: HubCore) => void; core?: Partial<HubCoreOptions> } = {},
): Promise<Stack> {
  const broker = await startBroker();
  const mock = new MockZ2m({ url: broker.url, latencyMs: 5, withDevice: opts.withDevice });
  const driver = new Zigbee2mqttDriver({ url: broker.url, requestTimeoutMs: 1000 });
  const store = openStore(':memory:');
  const cfg = new FakeConfigStore();
  const sent: Sent[] = [];
  const core = createHubCore({ driver, store, configStore: () => cfg, ...opts.core });
  core.publisher.addLink('local', recordingLink('local', sent));
  if (opts.claimed !== false) core.setIdentity(IDENTITY);
  opts.before?.(core);
  await mock.start();
  await driver.start();
  return {
    broker,
    mock,
    driver,
    core,
    store,
    cfg,
    sent,
    async close() {
      core.stop();
      await driver.stop();
      await mock.stop();
      await broker.close();
      store.close();
    },
  };
}
