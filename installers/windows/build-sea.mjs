// Builds out/windows/: Node SEA exe (esbuild CJS bundle + postject), native prebuilds, node.exe for Z2M,
// Mosquitto + Z2M (from .tools via scripts/fetch-tools.mjs), winsw, web dist-lan, install.ps1.
// Usage: node installers/windows/build-sea.mjs [--dry-run] [--skip-web] [--skip-tools]
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..', '..');
const args = new Set(process.argv.slice(2));
const dry = args.has('--dry-run');
const outBase = join(root, 'installers', 'windows', 'out');
const out = join(outBase, 'windows');
const bundleDir = join(outBase, 'bundle');
const versions = JSON.parse(readFileSync(join(root, 'installers', 'versions.json'), 'utf8'));
const agentDir = join(root, 'apps', 'hub-agent');
const NATIVE = ['better-sqlite3', 'serialport'];
const SKIP_DEPS = new Set(['prebuild-install']); // install-time only
const SEA_FUSE = 'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2';

const steps = [];
const step = (name, fn) => steps.push({ name, fn });
const run = (cmd, a, o = {}) => {
  const r = spawnSync(cmd, a, { stdio: 'inherit', shell: process.platform === 'win32' && /^(npx|pnpm|npm)$/.test(cmd), ...o });
  if (r.status !== 0) throw new Error(`${cmd} ${a.join(' ')} failed (exit ${r.status})`);
};
const sha = (f) => createHash('sha256').update(readFileSync(f)).digest('hex');

function findEsbuild() {
  const req = createRequire(join(agentDir, 'package.json'));
  try { return req.resolve('esbuild'); } catch { /* fall through to pnpm store */ }
  const store = join(root, 'node_modules', '.pnpm');
  const hit = existsSync(store) && readdirSync(store).filter((d) => /^esbuild@\d/.test(d)).sort().pop();
  if (hit) return join(store, hit, 'node_modules', 'esbuild', 'lib', 'main.js');
  throw new Error('esbuild not found (pnpm install first)');
}

/** Resolve package dirs from the hub-agent plus their runtime dependency closure. */
function packageClosure(names) {
  const seen = new Map();
  const visit = (name, fromDir) => {
    if (seen.has(name)) return;
    let pj;
    try { pj = createRequire(join(fromDir, 'noop.js')).resolve(`${name}/package.json`); } catch { return; }
    const dir = dirname(realpathSync(pj));
    seen.set(name, dir);
    const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
    for (const d of Object.keys({ ...pkg.dependencies, ...pkg.optionalDependencies })) if (!SKIP_DEPS.has(d)) visit(d, dir);
  };
  for (const n of names) visit(n, agentDir);
  return seen;
}

const tools = process.env.DN_TOOLS_DIR ? resolve(process.env.DN_TOOLS_DIR) : join(root, '.tools');
const webDist = join(root, 'apps', 'web', 'dist-lan');
const winswExe = join(tools, 'winsw', 'WinSW-x64.exe');

step('clean out/', () => {
  rmSync(outBase, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });
  mkdirSync(bundleDir, { recursive: true });
});

step('fetch tools (Mosquitto, Z2M via fetch-tools.mjs; winsw via curl) into .tools/', () => {
  if (!args.has('--skip-tools')) run(process.execPath, [join(root, 'scripts', 'fetch-tools.mjs')]);
  if (!existsSync(winswExe)) {
    const w = versions.winsw;
    mkdirSync(dirname(winswExe), { recursive: true });
    run('curl', ['-fsSL', '--retry', '3', '-o', winswExe, w.url]); // curl honours the corporate proxy
    if (sha(winswExe) !== w.sha256) { rmSync(winswExe); throw new Error('winsw sha256 mismatch'); }
  }
});

step('esbuild: apps/hub-agent/src/main.ts -> CJS bundle (native modules external)', async () => {
  const { build } = await import(pathToFileURL(findEsbuild()).href);
  await build({
    entryPoints: [join(agentDir, 'src', 'main.ts')],
    outfile: join(bundleDir, 'hub-agent.cjs'),
    bundle: true, platform: 'node', format: 'cjs', target: 'node22', sourcemap: false, logLevel: 'warning',
    external: [...NATIVE, '@serialport/*'],
    define: { 'import.meta.url': '__import_meta_url' },
    // In a SEA, require() only loads builtins; externals are resolved from <exeDir>/native/node_modules.
    banner: { js: [
      "const __nodeUrl = require('node:url'), __nodeModule = require('node:module'), __nodePath = require('node:path');",
      'const __import_meta_url = __nodeUrl.pathToFileURL(process.execPath).href;',
      "const __nativeRequire = __nodeModule.createRequire(__nodePath.join(__nodePath.dirname(process.execPath), 'native', 'node_modules', 'noop.js'));",
      'const __origRequire = require;',
      'require = Object.assign((id) => (id === "better-sqlite3" || id === "serialport" || id.startsWith("@serialport/")) ? __nativeRequire(id) : __origRequire(id), __origRequire);',
    ].join('\n') },
  });
});

step('postject: SEA blob -> out/windows/devicenet-agent.exe', () => {
  run(process.execPath, ['--experimental-sea-config', join(here, 'sea-config.json')], { cwd: root });
  const exe = join(out, 'devicenet-agent.exe');
  cpSync(process.execPath, exe);
  run('npx', ['--yes', 'postject', exe, 'NODE_SEA_BLOB', join(bundleDir, 'sea-prep.blob'), '--sentinel-fuse', SEA_FUSE]);
});

step('copy native packages (better-sqlite3, serialport bindings + deps) -> native/node_modules', () => {
  for (const [name, dir] of packageClosure(NATIVE)) {
    cpSync(dir, join(out, 'native', 'node_modules', name), {
      recursive: true,
      filter: (s) => !/[\\/](src|deps|test|docs)([\\/]|$)/.test(s.slice(dir.length)),
    });
  }
});

step('copy node.exe (for Zigbee2MQTT; a SEA exe cannot act as node)', () => {
  mkdirSync(join(out, 'node'), { recursive: true });
  cpSync(process.execPath, join(out, 'node', 'node.exe'));
});

step('copy Mosquitto + Zigbee2MQTT -> .tools/', () => {
  cpSync(join(tools, 'mosquitto'), join(out, '.tools', 'mosquitto'), { recursive: true });
  cpSync(join(tools, 'zigbee2mqtt'), join(out, '.tools', 'zigbee2mqtt'), { recursive: true, filter: (s) => !/[\\/]\.git([\\/]|$)/.test(s) });
});

step('web dist-lan (pnpm --filter @devicenet/web build:lan) -> web/dist-lan', () => {
  if (!args.has('--skip-web') && !existsSync(webDist)) run('pnpm', ['--filter', '@devicenet/web', 'build:lan']);
  cpSync(webDist, join(out, 'web', 'dist-lan'), { recursive: true });
});

step('winsw -> DeviceNetHub.exe/.xml, install.ps1, find-zigbee-port.ps1, versions.json', () => {
  cpSync(winswExe, join(out, 'DeviceNetHub.exe'));
  cpSync(join(here, 'winsw.xml'), join(out, 'DeviceNetHub.xml'));
  cpSync(join(here, 'install.ps1'), join(out, 'install.ps1'));
  cpSync(join(root, 'scripts', 'find-zigbee-port.ps1'), join(out, 'find-zigbee-port.ps1'));
  writeFileSync(join(out, 'versions.json'), JSON.stringify(versions, null, 2) + '\n');
});

const inputs = [
  ['hub-agent entry', join(agentDir, 'src', 'main.ts')],
  ['sea-config.json', join(here, 'sea-config.json')],
  ['winsw.xml', join(here, 'winsw.xml')],
  ['install.ps1', join(here, 'install.ps1')],
  ['versions.json', join(root, 'installers', 'versions.json')],
  ['fetch-tools.mjs', join(root, 'scripts', 'fetch-tools.mjs')],
];

if (dry) {
  console.log(`[dry-run] node ${process.version}; out=${out}`);
  for (const [n, p] of inputs) console.log(`[dry-run] input ${existsSync(p) ? 'ok     ' : 'MISSING'} ${n}`);
  for (const k of ['mosquitto', 'zigbee2mqtt', 'winsw']) console.log(`[dry-run] pin ${k}@${versions[k].version} sha256=${versions[k].sha256.slice(0, 12)}...`);
  try { console.log(`[dry-run] esbuild ${findEsbuild()}`); } catch (e) { console.log(`[dry-run] esbuild MISSING (${e.message})`); }
  console.log(`[dry-run] native closure: ${[...packageClosure(NATIVE).keys()].join(', ') || '(none resolved)'}`);
  console.log(`[dry-run] web dist-lan ${existsSync(webDist) ? 'present' : 'absent (would run build:lan)'}; tools ${existsSync(tools) ? 'present' : 'absent (would fetch)'}`);
  steps.forEach((s, i) => console.log(`[dry-run] step ${i + 1}: ${s.name}`));
  process.exit(inputs.some(([, p]) => !existsSync(p)) ? 1 : 0);
}

for (const [i, s] of steps.entries()) {
  console.log(`\n== [${i + 1}/${steps.length}] ${s.name}`);
  await s.fn();
}
console.log(`\nDone: ${out}`);
