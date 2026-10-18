// RAM/CPU sampler for the 7-day soak (NFR). Usage: node tools/soak/sample.mjs <pid> [intervalSec=60] [out=soak.csv]
// Appends `iso,rssMb,cpuPct` rows. CPU% = process cpu time delta / wall delta (1 core = 100). Stops when the pid disappears.
import { appendFileSync, existsSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const pid = Number(process.argv[2]);
const every = Number(process.argv[3] ?? 60) * 1000;
const out = process.argv[4] ?? 'soak.csv';
if (!Number.isInteger(pid) || pid <= 0) {
  console.error('usage: node tools/soak/sample.mjs <pid> [intervalSec] [out.csv]');
  process.exit(2);
}
if (!existsSync(out)) writeFileSync(out, 'time,rssMb,cpuPct\n');

/** { rssMb, cpuSec } or null when the process is gone */
function read() {
  try {
    if (process.platform === 'win32') {
      const ps = `$p=Get-Process -Id ${pid} -ErrorAction Stop; \"$($p.WorkingSet64) $($p.TotalProcessorTime.TotalSeconds)\"`;
      const [ws, cpu] = execFileSync('powershell', ['-NoProfile', '-Command', ps], { encoding: 'utf8' }).trim().split(' ');
      return { rssMb: Number(ws) / 1048576, cpuSec: Number(cpu) };
    }
    const [rssKb, , cpu] = execFileSync('ps', ['-o', 'rss=,etimes=,cputimes=', '-p', String(pid)], { encoding: 'utf8' }).trim().split(/\s+/);
    return { rssMb: Number(rssKb) / 1024, cpuSec: Number(cpu) };
  } catch {
    return null;
  }
}

let prev = read();
let prevAt = Date.now();
if (!prev) {
  console.error(`pid ${pid} not found`);
  process.exit(1);
}
const timer = setInterval(() => {
  const cur = read();
  const now = Date.now();
  if (!cur) {
    clearInterval(timer);
    console.log('process ended');
    return;
  }
  const cpuPct = ((cur.cpuSec - prev.cpuSec) / ((now - prevAt) / 1000)) * 100;
  appendFileSync(out, `${new Date(now).toISOString()},${cur.rssMb.toFixed(1)},${Math.max(0, cpuPct).toFixed(2)}\n`);
  prev = cur;
  prevAt = now;
}, every);
