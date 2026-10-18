// file named actions-test.ts (not actions.test.ts): *.test.ts is a vitest/tsconfig test glob
import { ActionList } from '../../automation/runner.js';
import type { CommandHandler } from './types.js';

/** S-30 "Chạy thử": validate with `Action[]`, run unsaved with `source.kind="test"`; ack `{runId}`. */
export const actionsTest: CommandHandler<'actions.test'> = async (cmd, ctx) => {
  const parsed = ActionList.safeParse(cmd.actions);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return { ok: false, error: 'invalid', message: `${issue?.path.join('.') ?? ''}: ${issue?.message ?? 'invalid actions'}`.slice(0, 300) };
  }
  if (!ctx.runner) return { ok: false, error: 'internal', message: 'runner not wired' };
  const h = ctx.runner.runTest(parsed.data);
  return { ok: true, result: { runId: h.runId } };
};
