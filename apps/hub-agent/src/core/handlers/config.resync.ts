import type { CommandHandler } from './types.js';
import { errorToAck } from './types.js';

export const configResync: CommandHandler<'config.resync'> = async (_cmd, ctx) => {
  if (!ctx.configResync) return { ok: true, message: 'no_sync' };
  try {
    await ctx.configResync();
    return { ok: true };
  } catch (e) {
    return errorToAck(e);
  }
};
