#!/usr/bin/env node
// `pnpm dev` / `pnpm dev:real` (research R14): ordered start with TCP readiness, prefixed output,
// Ctrl+C kills every child tree. Components already listening on their port are reused.
//
//   emulators (auth 9099, firestore 8085, ui 4000) → api :3000 → dev-cloud-broker tcp 1884 / ws 8084
//   → hub-agent (DN_EMULATOR=1, mock Z2M unless --real; LAN :8080) → web dev :5173 (if apps/web exists)
//
// Flags: --real (real Mosquitto + Zigbee2MQTT), --no-web, --no-emulators (use already running ones)
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import {
  cleanEnv,
  emulatorEnv,
  emulatorsProc,
  EMU,
  hasWeb,
  isWin,
  killTree,
  repoRoot,
  sleep,
  startProc,
  stopProc,
  tcpOpen,
  tsxCli,
  viteCli,
  waitTcp,
} from './lib.mjs';

const args = new Set(process.argv.slice(2));
const real = args.has('--real');
const children = [];

const shared = {
  DN_EMULATOR: '1',
  EMQX_SHARED_TOKEN: process.env.EMQX_SHARED_TOKEN ?? 'dev-token',
  DN_MQTT_HOST: process.env.DN_MQTT_HOST ?? '127.0.0.1',
  DN_MQTT_PORT: process.env.DN_MQTT_PORT ?? '1884',
  DN_MQTT_WSS_PORT: process.env.DN_MQTT_WSS_PORT ?? '8084',
  DN_API_BASE_URL: process.env.DN_API_BASE_URL ?? 'http://127.0.0.1:3000',
  ...emulatorEnv(),
};

const log = (msg) => process.stdout.write(`\x1b[1m[dev]\x1b[0m ${msg}\n`);

let shuttingDown = false;
async function shutdown(code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  log('stopping all processes …');
  // On Windows Ctrl+C already reached every child in this console: give them time to exit cleanly.
  const deadline = Date.now() + 4000;
  while (isWin && Date.now() < deadline && children.some((c) => c.exitCode === null)) await sleep(100);
  await Promise.all([...children].reverse().map((c) => (isWin ? killTree(c) : stopProc(c))));
  process.exit(code);
}
process.on('SIGINT', () => void shutdown(0));
process.on('SIGTERM', () => void shutdown(0));
process.on('SIGBREAK', () => void shutdown(0));

async function step(name, port, start, timeoutMs, host = '127.0.0.1') {
  if (await tcpOpen(port, host)) {
    log(`${name}: :${port} already in use — reusing the running instance`);
    return null;
  }
  const child = start();
  children.push(child);
  child.on('exit', (code) => {
    if (!shuttingDown) log(`${name} exited (${code}) — other processes keep running; Ctrl+C to stop all`);
  });
  await waitTcp(port, { name, timeoutMs, child, host });
  log(`${name} ready on :${port}`);
  return child;
}

try {
  const tsx = tsxCli();
  log(`mode: ${real ? 'REAL (Mosquitto + Zigbee2MQTT + dongle)' : 'mock Z2M'} — repo ${repoRoot}`);
  if (real) {
    const chk = spawnSync(process.execPath, [join(repoRoot, 'tools', 'check-tools.mjs')], { encoding: 'utf8', env: process.env });
    process.stdout.write(chk.stdout);
    if (chk.status !== 0) log('WARNING: tools missing — hub-agent falls back to the embedded broker and Z2M stays offline');
  }

  if (!args.has('--no-emulators')) {
    await step('emulators', EMU.firestore, () => emulatorsProc(), 180_000);
    await waitTcp(EMU.auth, { name: 'auth emulator', timeoutMs: 30_000 });
    log(`Emulator UI: http://127.0.0.1:${EMU.ui}`);
  }

  await step(
    'api',
    3000,
    () =>
      startProc('api', process.execPath, [tsx, 'watch', 'src/main.ts'], {
        cwd: join(repoRoot, 'apps', 'api'),
        env: cleanEnv({ ...shared, PORT: '3000', HOST: '127.0.0.1' }),
      }),
    60_000,
  );

  await step(
    'dev-cloud-broker',
    1884,
    () =>
      startProc('broker', process.execPath, [tsx, 'src/cli.ts'], {
        cwd: join(repoRoot, 'tools', 'dev-cloud-broker'),
        env: cleanEnv({ ...shared, DEV_API_URL: 'http://127.0.0.1:3000', DEV_BROKER_TCP_PORT: '1884', DEV_BROKER_WS_PORT: '8084' }),
      }),
    30_000,
  );

  const hubEnv = {
    ...shared,
    DN_MOCK_Z2M: real ? '0' : '1',
    DN_DATA_DIR: process.env.DN_DATA_DIR ?? join(repoRoot, '.data', real ? 'hub' : 'hub-mock'),
    ...(process.env.DN_TOOLS_DIR ? { DN_TOOLS_DIR: process.env.DN_TOOLS_DIR } : {}),
  };
  // Real Z2M can take up to 60 s (bridge/state wait) before the LAN server opens.
  await step(
    'hub-agent',
    8080,
    () => startProc('hub', process.execPath, [tsx, 'src/main.ts'], { cwd: join(repoRoot, 'apps', 'hub-agent'), env: cleanEnv(hubEnv) }),
    real ? 120_000 : 45_000,
  );
  log('hub LAN: http://127.0.0.1:8080  (claim code: http://127.0.0.1:8080/setup)');

  if (!args.has('--no-web') && hasWeb()) {
    await step(
      'web',
      5173,
      () => startProc('web', process.execPath, [viteCli(), '--port', '5173', '--strictPort'], { cwd: join(repoRoot, 'apps', 'web'), env: cleanEnv() }),
      60_000,
      'localhost', // vite binds localhost (::1 on Windows)
    );
    log('web: http://localhost:5173');
  } else if (!args.has('--no-web')) {
    log('apps/web not found (or not installed) — skipping web dev server');
  }
  log('all up. Ctrl+C stops everything.');
} catch (e) {
  log(`start failed: ${e.message}`);
  await shutdown(1);
}
