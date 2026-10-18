import type { CommandHandler } from './types.js';

export const stateRepublish: CommandHandler<'state.republish'> = async (_cmd, ctx) => {
  ctx.publisher.republishAll();
  return { ok: true };
};
