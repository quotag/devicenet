import { actionsTest } from './actions-test.js';
import { configResync } from './config.resync.js';
import { devicePing } from './device.ping.js';
import { deviceRemove } from './device.remove.js';
import { deviceRename } from './device.rename.js';
import { historyGet } from './history.get.js';
import { pairingStart, pairingStop } from './pairing.js';
import { sceneRun } from './scene.run.js';
import { stateRepublish } from './state.republish.js';
import type { HandlerMap } from './types.js';

export * from './types.js';

/** Command type → handler (one file per type under src/core/handlers). */
export const defaultHandlers: HandlerMap = {
  'pairing.start': pairingStart,
  'pairing.stop': pairingStop,
  'device.remove': deviceRemove,
  'device.rename': deviceRename,
  'device.ping': devicePing,
  'scene.run': sceneRun,
  'actions.test': actionsTest,
  'history.get': historyGet,
  'config.resync': configResync,
  'state.republish': stateRepublish,
};
