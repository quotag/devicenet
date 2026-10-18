import { queryBuckets } from '../../store/history.js';
import type { CommandHandler } from './types.js';

/** US-13 over cloud: ack `result {points}` (≤300 buckets of avg). SQLite is sync and indexed, well under 2 s. */
export const historyGet: CommandHandler<'history.get'> = async (cmd, ctx) => {
  if (!ctx.history) return { ok: false, error: 'internal', message: 'history_unavailable' };
  if (cmd.to < cmd.from) return { ok: false, error: 'invalid', message: 'to < from' };
  try {
    return { ok: true, result: { points: queryBuckets(ctx.history, cmd.deviceId, cmd.property, cmd.from, cmd.to, cmd.step) } };
  } catch (e) {
    return { ok: false, error: 'internal', message: (e as Error).message.slice(0, 300) };
  }
};
