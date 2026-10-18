import type { CommandHandler } from './types.js';
import { errorToAck } from './types.js';

/** S-20: ask the driver to re-read the device; availability/state flow back normally. */
export const devicePing: CommandHandler<'device.ping'> = async (cmd, ctx) => {
  const entry = ctx.registry.get(cmd.deviceId);
  if (!entry) return { ok: false, error: 'not_found' };
  try {
    await ctx.driver.ping(entry.device.externalId);
  } catch (e) {
    return errorToAck(e);
  }
  return { ok: true };
};
