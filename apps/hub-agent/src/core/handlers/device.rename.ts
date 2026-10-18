import type { CommandHandler } from './types.js';
import { errorToAck } from './types.js';

/** OQ-1: the name goes to the Z2M `description` option; friendly_name stays `dev_…`. */
export const deviceRename: CommandHandler<'device.rename'> = async (cmd, ctx) => {
  const entry = ctx.registry.get(cmd.deviceId);
  if (!entry) return { ok: false, error: 'not_found' };
  try {
    await ctx.driver.rename(entry.device.externalId, cmd.name);
  } catch (e) {
    return errorToAck(e);
  }
  // local copy only (app owns `name` in Firestore)
  ctx.registry.updateDevice(cmd.deviceId, { name: cmd.name });
  return { ok: true };
};
