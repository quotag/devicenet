import type { CommandHandler } from './types.js';

export const pairingStart: CommandHandler<'pairing.start'> = (cmd, ctx) => ctx.pairing.start(cmd.seconds);
export const pairingStop: CommandHandler<'pairing.stop'> = (_cmd, ctx) => ctx.pairing.stop();
