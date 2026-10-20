#!/usr/bin/env node
// Packages installers/windows/out/windows/ into devicenet-windows-x64.zip + .sha256
// Usage: node scripts/package-agent-win.mjs [--dry-run] [--skip-build] [--copy-to-web]
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const args = new Set(process.argv.slice(2));
const dry = args.has('--dry-run');

const outWindows = join(root, 'installers', 'windows', 'out', 'windows');
const outDir = join(root, 'installers', 'windows', 'out');
const zipName = 'devicenet-windows-x64.zip';
const zipPath = join(outDir, zipName);
const shaPath = join(outDir, `${zipName}.sha256`);
const webAgentDir = join(root, 'apps', 'web', 'public', 'agent');

if (dry) {
  console.log(`[dry-run] Packaging destination: ${zipPath}`);
  console.log(`[dry-run] Source: ${outWindows} (${existsSync(outWindows) ? 'exists' : 'requires build'})`);
  console.log(`[dry-run] Web target: ${webAgentDir}`);
  process.exit(0);
}

const run = (cmd, a, o = {}) => {
  const r = spawnSync(cmd, a, { stdio: 'inherit', shell: process.platform === 'win32' && /^(npx|pnpm|npm)$/.test(cmd), ...o });
  if (r.status !== 0) throw new Error(`${cmd} ${a.join(' ')} failed (exit ${r.status})`);
};

// 1. Build if out/windows/ is missing or not skipped
if (!args.has('--skip-build') && !existsSync(join(outWindows, 'devicenet-agent.exe'))) {
  console.log('== [1/4] Building Windows SEA bundle (build-sea.mjs)...');
  run(process.execPath, [join(root, 'installers', 'windows', 'build-sea.mjs')]);
}

if (!existsSync(join(outWindows, 'devicenet-agent.exe'))) {
  throw new Error(`Build directory missing: ${outWindows}. Run build-sea.mjs first.`);
}

// 2. Compress out/windows/* to out/devicenet-windows-x64.zip
console.log(`== [2/4] Packaging ${outWindows} -> ${zipPath}...`);
mkdirSync(outDir, { recursive: true });
if (existsSync(zipPath)) rmSync(zipPath, { force: true });

const psCmd = `Compress-Archive -Path '${outWindows}\\*' -DestinationPath '${zipPath}' -Force`;
const psRes = spawnSync('powershell.exe', ['-NoProfile', '-Command', psCmd], { stdio: 'inherit' });
if (psRes.status !== 0) throw new Error(`Compress-Archive failed with exit code ${psRes.status}`);

const stat = statSync(zipPath);
const sizeMb = (stat.size / (1024 * 1024)).toFixed(2);
console.log(`== [3/4] Package size: ${sizeMb} MB (${stat.size} bytes)`);

// 3. Compute SHA256
const hash = createHash('sha256').update(readFileSync(zipPath)).digest('hex').toUpperCase();
writeFileSync(shaPath, hash + '\n', 'utf8');
console.log(`== SHA256: ${hash}`);

// 4. Copy to web public directory if requested or if apps/web/public/agent exists
if (args.has('--copy-to-web') || existsSync(webAgentDir)) {
  console.log(`== [4/4] Copying package to ${webAgentDir}...`);
  mkdirSync(webAgentDir, { recursive: true });
  copyFileSync(zipPath, join(webAgentDir, zipName));
  copyFileSync(shaPath, join(webAgentDir, `${zipName}.sha256`));
}

console.log('== Done! Package ready.');
