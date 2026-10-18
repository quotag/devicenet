import type { CommandHandler } from './types.js';
import { errorToAck } from './types.js';

/** Z2M remove (force when asked) -> `removed`, retained state cleared, referencing rules/scenes broken. */
export const deviceRemove: CommandHandler<'device.remove'> = async (cmd, ctx) => {
  if (!ctx.registry.get(cmd.deviceId)) return { ok: false, error: 'not_found' };
  if (!ctx.lifecycle) return { ok: false, error: 'internal', message: 'lifecycle not wired' };
  try {
    await ctx.lifecycle.removeDevice(cmd.deviceId, cmd.force);
  } catch (e) {
    return errorToAck(e);
  }
  return { ok: true };
};
