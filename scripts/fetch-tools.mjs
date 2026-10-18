#!/usr/bin/env node
// Idempotent fetch of local-dev tools (Mosquitto + Zigbee2MQTT) into .tools/ (gitignored).
// Usage: node scripts/fetch-tools.mjs [--force]
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const tools = join(root, '.tools');
const dl = join(tools, 'dl');
const stamp = join(tools, '.fetched.json');
const force = process.argv.includes('--force');
const isWin = process.platform === 'win32';
const versions = JSON.parse(readFileSync(join(root, 'installers', 'versions.json'), 'utf8'));
const fetched = existsSync(stamp) ? JSON.parse(readFileSync(stamp, 'utf8')) : {};

const run = (cmd, args, opts = {}) => {
  const r = spawnSync(cmd, args, { stdio: 'inherit', shell: isWin && /^(pnpm|npm|npx)$/.test(cmd), ...opts });
  if (r.status !== 0) throw new Error(`${cmd} ${args.join(' ')} failed (exit ${r.status})`);
};

async function download(url, file, sha256) {
  if (existsSync(file) && (!sha256 || sha(file) === sha256)) return;
  mkdirSync(dirname(file), { recursive: true });
  console.log(`download ${url}`);
  // curl honours corporate proxy env/settings; Node fetch does not. curl.exe ships with Windows 10+.
  run("curl", ["-fsSL", "--retry", "3", "-o", file, url]);
  if (sha256 && sha(file) !== sha256) { rmSync(file); throw new Error(`sha256 mismatch for ${url}`); }
}
const sha = (f) => createHash('sha256').update(readFileSync(f)).digest('hex');
const save = () => writeFileSync(stamp, JSON.stringify(fetched, null, 2) + '\n');

function find7z() {
  const c = [process.env.SEVEN_ZIP, 'C:/Program Files/7-Zip/7z.exe', 'C:/Program Files (x86)/7-Zip/7z.exe'].filter(Boolean);
  const hit = c.find((p) => existsSync(p));
  if (hit) return hit;
  if (spawnSync('7z', ['i'], { stdio: 'ignore', shell: isWin }).status === 0) return '7z';
  throw new Error('7-Zip not found (set SEVEN_ZIP env var to 7z.exe)');
}

async function mosquitto() {
  const v = versions.mosquitto;
  const dir = join(tools, 'mosquitto');
  if (!isWin) { console.log('mosquitto: on Linux/macOS use system mosquitto (apt install mosquitto) or docker eclipse-mosquitto'); return; }
  if (!force && fetched.mosquitto === v.version && existsSync(join(dir, 'mosquitto.exe'))) return console.log(`mosquitto ${v.version} ok`);
  const exe = join(dl, `mosquitto-${v.version}.exe`);
  await download(v.url, exe, v.sha256);
  rmSync(dir, { recursive: true, force: true });
  run(find7z(), ['x', exe, `-o${dir}`, '-y', '-bso0', '-bsp0']);
  rmSync(join(dir, '$PLUGINSDIR'), { recursive: true, force: true });
  if (!existsSync(join(dir, 'mosquitto.exe'))) throw new Error('mosquitto.exe missing after extraction');
  fetched.mosquitto = v.version; save();
  console.log(`mosquitto ${v.version} extracted to ${dir}`);
}

async function z2m() {
  const v = versions.zigbee2mqtt;
  const dir = join(tools, 'zigbee2mqtt');
  if (!force && fetched.zigbee2mqtt === v.version && existsSync(join(dir, 'dist', 'controller.js'))) return console.log(`zigbee2mqtt ${v.version} ok`);
  const tgz = join(dl, `zigbee2mqtt-${v.version}.tar.gz`);
  await download(v.url, tgz, v.sha256);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  run(isWin ? 'C:/Windows/System32/tar.exe' : 'tar', ['-xzf', tgz, '-C', dir, '--strip-components=1']);
  // Z2M pins pnpm via packageManager; use npx to get the exact version regardless of the global pnpm.
  const pnpm = (...a) => run('npx', ['--yes', `pnpm@${v.pnpm}`, ...a], { cwd: dir, env: { ...process.env, CI: 'true' } });
  pnpm('install', '--frozen-lockfile');
  pnpm('run', 'build');
  if (!existsSync(join(dir, 'dist', 'controller.js'))) throw new Error('zigbee2mqtt build produced no dist/controller.js');
  fetched.zigbee2mqtt = v.version; save();
  console.log(`zigbee2mqtt ${v.version} built; run: node .tools/zigbee2mqtt/index.js (set ZIGBEE2MQTT_DATA)`);
}

mkdirSync(tools, { recursive: true });
await mosquitto();
await z2m();
