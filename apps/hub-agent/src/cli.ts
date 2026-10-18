import { realpathSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deleteCredentials } from './claim/credentials.js';
import { deleteKeyPair } from './claim/keys.js';
import { loadConfig } from './config/load.js';
import { resolvePaths } from './config/paths.js';

export interface CliIo {
  out(line: string): void;
  err(line: string): void;
  env?: NodeJS.ProcessEnv;
  cwd?: string;
}

const USAGE = 'usage: devicenet-agent reset [--config <config.yaml>] [--data-dir <dir>]';

function flag(args: string[], name: string): string | undefined {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
}

/**
 * `devicenet-agent reset` (FR-H02): delete credentials.json + hub.key so the agent claims again.
 * Keeps the Z2M database and the `devices` table (hub.db). Returns the exit code.
 */
export function reset(args: string[], io: CliIo): number {
  const env = io.env ?? process.env;
  const dataDirArg = flag(args, '--data-dir');
  const cfg = loadConfig({ file: flag(args, '--config'), env: dataDirArg ? { ...env, DN_DATA_DIR: dataDirArg } : env });
  const paths = resolvePaths(cfg, { cwd: io.cwd });
  const c = deleteCredentials(paths.credentials);
  const k = deleteKeyPair(paths.hubKey);
  io.out(`reset: credentials.json ${c ? 'đã xóa' : 'không có'}, hub.key ${k ? 'đã xóa' : 'không có'} (${paths.dataDir})`);
  io.out('Thiết bị Zigbee và bảng devices được giữ nguyên. Khởi động lại agent để lấy mã claim mới.');
  return 0;
}

/**
 * CLI dispatcher. Returns the exit code when `argv` names a CLI command, or null when the agent
 * should boot normally (main.ts, B13, calls this first).
 */
export function runCli(argv: string[], io: CliIo = { out: (l) => console.log(l), err: (l) => console.error(l) }): number | null {
  const [cmd, ...rest] = argv;
  if (cmd === undefined) return null;
  if (cmd === 'reset') {
    try {
      return reset(rest, io);
    } catch (e) {
      io.err(`reset failed: ${(e as Error).message}`);
      return 1;
    }
  }
  if (cmd === '--help' || cmd === 'help') {
    io.out(USAGE);
    return 0;
  }
  return null;
}

const isEntry = (() => {
  try {
    return !!process.argv[1] && realpathSync(resolve(process.argv[1])) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
})();
if (isEntry) {
  const code = runCli(process.argv.slice(2));
  if (code === null) {
    console.error(USAGE);
    process.exitCode = 2;
  } else process.exitCode = code;
}
