#!/usr/bin/env node
// `pnpm tools:check` — are the pinned Mosquitto / Zigbee2MQTT installs and Java present?
// Tools dir: env DN_TOOLS_DIR, else <repo>/.tools (fill it with `pnpm tools:fetch`).
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const toolsDir = process.env.DN_TOOLS_DIR ? resolve(process.env.DN_TOOLS_DIR) : join(repoRoot, '.tools');
const isWin = process.platform === 'win32';

const checks = [];
const add = (name, okay, hint) => checks.push({ name, ok: okay, hint });
const file = (rel) => existsSync(join(toolsDir, rel));
const cmdOk = (cmd, args) => {
  try {
    return execFileSync(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8', windowsHide: true, timeout: 10_000 }) || true;
  } catch (e) {
    return e.stderr ? String(e.stderr) || false : false;
  }
};

if (isWin) {
  add('mosquitto.exe', file('mosquitto/mosquitto.exe'), 'pnpm tools:fetch');
  add('mosquitto_passwd.exe', file('mosquitto/mosquitto_passwd.exe'), 'pnpm tools:fetch');
} else {
  add('mosquitto (PATH)', !!cmdOk('mosquitto', ['-h']), 'apt install mosquitto');
}
add('zigbee2mqtt/index.js', file('zigbee2mqtt/index.js'), 'pnpm tools:fetch');
add('zigbee2mqtt/dist (built)', file('zigbee2mqtt/dist'), 'pnpm tools:fetch (builds Z2M)');
const java = cmdOk('java', ['-version']);
add('java on PATH (Firebase emulators)', !!java && /version/i.test(String(java === true ? 'version' : java)), 'install JDK 21 and add it to PATH');

console.log(`tools dir: ${toolsDir}${process.env.DN_TOOLS_DIR ? ' (DN_TOOLS_DIR)' : ''}`);
for (const c of checks) console.log(`  ${c.ok ? '✔' : '✘'} ${c.name}${c.ok ? '' : `  → ${c.hint}`}`);
const missing = checks.filter((c) => !c.ok).length;
if (missing) {
  console.log(`\n${missing} missing. Mock mode (pnpm dev) still works with the embedded broker; pnpm dev:real needs all of them.`);
  process.exit(1);
}
console.log('\nall tools present.');
