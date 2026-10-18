import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { HubConfig } from './schema.js';

/** Walk up from `from` to the dir containing pnpm-workspace.yaml (monorepo root). */
export function findRepoRoot(from: string = dirname(fileURLToPath(import.meta.url))): string {
  let dir = resolve(from);
  for (;;) {
    if (existsSync(join(dir, 'pnpm-workspace.yaml'))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return resolve(from);
    dir = parent;
  }
}

export interface HubPaths {
  dataDir: string;
  configFile: string;
  hubKey: string;
  credentials: string;
  secrets: string;
  db: string;
  logsDir: string;
  runDir: string;
  mosquittoDir: string;
  z2mDir: string;
  toolsDir: string;
}

export function resolvePaths(
  cfg: Pick<HubConfig, 'dataDir' | 'toolsDir'>,
  opts: { cwd?: string; repoRoot?: string } = {},
): HubPaths {
  const cwd = opts.cwd ?? process.cwd();
  const dataDir = resolve(cwd, cfg.dataDir);
  const toolsDir = cfg.toolsDir ? resolve(cwd, cfg.toolsDir) : join(opts.repoRoot ?? findRepoRoot(), '.tools');
  return {
    dataDir,
    configFile: join(dataDir, 'config.yaml'),
    hubKey: join(dataDir, 'hub.key'),
    credentials: join(dataDir, 'credentials.json'),
    secrets: join(dataDir, 'secrets.json'),
    db: join(dataDir, 'hub.db'),
    logsDir: join(dataDir, 'logs'),
    runDir: join(dataDir, 'run'),
    mosquittoDir: join(dataDir, 'mosquitto'),
    z2mDir: join(dataDir, 'z2m'),
    toolsDir,
  };
}
