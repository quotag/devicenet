import type { CommandHandler } from './types.js';

/** Tap-to-run (data-model §3.5): ack `{runId}` immediately; progress streams on `runs`. */
export const sceneRun: CommandHandler<'scene.run'> = async (cmd, ctx) => {
  if (!ctx.runner) return { ok: false, error: 'internal', message: 'runner not wired' };
  const h = ctx.runner.runScene(cmd.sceneId);
  if (!h) return { ok: false, error: 'not_found', message: `scene ${cmd.sceneId}` };
  return { ok: true, result: { runId: h.runId } };
};
