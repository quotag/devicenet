import type { Command, CommandEnvelope } from '@devicenet/shared';
import type { z } from 'zod';
import type { AckError } from '@devicenet/shared';
import type { Driver } from '../../drivers/Driver.js';
import type { HubEvents } from '../events.js';
import type { DeviceLifecycle } from '../lifecycle.js';
import type { PairingManager } from '../pairing.js';
import type { Publisher } from '../publisher.js';
import type { Registry } from '../registry.js';
import type { HistoryRepo } from '../../store/history.js';
import type { ActionRunner } from '../../automation/runner.js';

export type AckErrorCode = z.infer<typeof AckError>;

export type CommandResult =
  | { ok: true; result?: Record<string, unknown>; message?: string }
  | { ok: false; error: AckErrorCode; message?: string; result?: Record<string, unknown> };

export type CommandType = Command['type'];

/** Everything a handler may touch. Optional hooks are wired by later batches (B09 sync, B15 runner, B17 history). */
export interface CommandContext {
  registry: Registry;
  driver: Driver;
  publisher: Publisher;
  events: HubEvents;
  pairing: PairingManager;
  /** B09: re-read config from Firestore */
  configResync?: () => Promise<void>;
  /** B18 */
  lifecycle?: DeviceLifecycle;
  /** B17: numeric history (history.get) */
  history?: HistoryRepo;
  /** B15: action runner (scene.run, actions.test) */
  runner?: ActionRunner;
}

export type CommandHandler<T extends CommandType = CommandType> = (
  cmd: Extract<Command, { type: T }>,
  ctx: CommandContext,
  env: CommandEnvelope,
) => Promise<CommandResult>;

export type HandlerMap = { [K in CommandType]: CommandHandler<K> };

/** Map a driver error to an ack. */
export function errorToAck(e: unknown): CommandResult {
  const msg = (e as Error)?.message ?? String(e);
  if (/timed out|timeout/i.test(msg)) return { ok: false, error: 'timeout', message: msg.slice(0, 300) };
  if (/not started|offline|ECONN|closed/i.test(msg)) return { ok: false, error: 'driver_unavailable', message: msg.slice(0, 300) };
  return { ok: false, error: 'internal', message: msg.slice(0, 300) };
}

/** Post-M-Local stub (tasks.md shared-file rule). */
export const notImplemented = async (): Promise<CommandResult> => ({ ok: false, error: 'internal', message: 'not_implemented' });
