#!/usr/bin/env node
// `pnpm smoke` — M-Local end-to-end gate (< 30 s, every step bounded, everything killed at the end).
// Self-contained on its own ports so it can run next to `pnpm dev`:
//   emulators (reused when 8085 is open) · api :3100 · dev broker tcp 1894 / ws 8094 · hub-agent (mock Z2M,
//   LAN :8180, local broker 1983 / ws 9101, temp data dir)
// Flow: signUp (Auth emulator REST) → bootstrap → hub claim code (/setup) → claim → status online (MQTT)
//   → webhook mirror hubs.online=true (Firestore) → api /healthz + hub /api/health → pairing.start
//   → mock interview → device doc in Firestore → set state:true via cloud broker → retained state true
//   → same toggle via the LAN ws broker (state false).
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { cleanEnv, emulatorEnv, emulatorsProc, EMU, killTree, repoRoot, sleep, tcpOpen, tsxCli, startProc, waitTcp } from '../dev/lib.mjs';

for (const k of Object.keys(process.env)) if (/^(https?|grpc|all)_proxy$/i.test(k)) delete process.env[k];

const T0 = Date.now();
const BUDGET_MS = Number(process.env.SMOKE_BUDGET_MS ?? 30_000);
const verbose = process.argv.includes('--verbose');
/** --full: also restart the hub and check it comes back claimed (quickstart step 7, ~5 s more) */
const full = process.argv.includes('--full');
const P = { api: 3100, tcp: 1894, ws: 8094, lan: 8180, mqtt: 1983, mqttWs: 9101 };
const API = `http://127.0.0.1:${P.api}`;
const HUB = `http://127.0.0.1:${P.lan}`;
const FS = `http://127.0.0.1:${EMU.firestore}/v1/projects/${EMU.project}/databases/(default)/documents`;

const children = [];
const hubLog = [];
const t = () => `${((Date.now() - T0) / 1000).toFixed(1)}s`;
const ok = (m) => process.stdout.write(`  \x1b[32m✔\x1b[0m ${m} \x1b[2m(${t()})\x1b[0m\n`);
const info = (m) => process.stdout.write(`  · ${m} \x1b[2m(${t()})\x1b[0m\n`);

const mqtt = (await import(pathToFileURL(createRequire(join(repoRoot, 'apps', 'hub-agent', 'package.json')).resolve('mqtt')).href)).default;

const B32 = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
function ulid() {
  let ts = Date.now();
  let time = '';
  for (let i = 0; i < 10; i++) {
    time = B32[ts % 32] + time;
    ts = Math.floor(ts / 32);
  }
  let rnd = '';
  for (let i = 0; i < 16; i++) rnd += B32[Math.floor(Math.random() * 32)];
  return time + rnd;
}

async function until(what, fn, timeoutMs = 8000, everyMs = 150) {
  const deadline = Date.now() + timeoutMs;
  let last;
  while (Date.now() < deadline) {
    try {
      const v = await fn();
      if (v) return v;
    } catch (e) {
      last = e;
    }
    await sleep(everyMs);
  }
  throw new Error(`timeout (${timeoutMs} ms): ${what}${last ? ` — last error: ${last.message}` : ''}`);
}

async function http(method, url, body, headers = {}) {
  const res = await fetch(url, {
    method,
    headers: { ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(15_000),
  });
  const text = await res.text();
  let json;
  try {
    json = text ? JSON.parse(text) : undefined;
  } catch {
    json = text;
  }
  return { status: res.status, body: json };
}

/** Firestore emulator REST read as admin (`Bearer owner` bypasses rules). */
async function fsGet(path) {
  const r = await http('GET', `${FS}/${path}`, undefined, { authorization: 'Bearer owner' });
  return r.status === 200 ? r.body : null;
}

function waitMsg(client, topic, pred, timeoutMs, what) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      client.off('message', on);
      reject(new Error(`timeout (${timeoutMs} ms): ${what}`));
    }, timeoutMs);
    const on = (tp, buf) => {
      if (topic && tp !== topic && !(topic instanceof RegExp && topic.test(tp))) return;
      let j;
      try {
        j = JSON.parse(buf.toString('utf8'));
      } catch {
        return;
      }
      if (pred(j, tp)) {
        clearTimeout(timer);
        client.off('message', on);
        resolve({ topic: tp, msg: j });
      }
    };
    client.on('message', on);
  });
}

const dataDir = join(repoRoot, '.data', `smoke-${process.pid}`);
let exitCode = 1;
let restartMs = 0; // --full restart phase is not counted in the budget
const clients = [];

async function cleanup() {
  for (const c of clients) c.end(true);
  await Promise.all([...children].reverse().map((c) => killTree(c)));
  await sleep(300);
  try {
    rmSync(dataDir, { recursive: true, force: true });
  } catch {
    /* sqlite file may still be locked for a moment on Windows */
  }
}

const watchdog = setTimeout(async () => {
  process.stdout.write(`\n\x1b[31m✘ smoke exceeded hard limit ${BUDGET_MS + 75_000} ms\x1b[0m\n`);
  await cleanup();
  process.exit(1);
}, BUDGET_MS + 75_000);

try {
  process.stdout.write('DeviceNet M-Local smoke\n');
  const tsx = tsxCli();
  const env = {
    DN_EMULATOR: '1',
    EMQX_SHARED_TOKEN: 'dev-token',
    DN_MQTT_HOST: '127.0.0.1',
    DN_MQTT_PORT: String(P.tcp),
    DN_MQTT_WSS_PORT: String(P.ws),
    DN_API_BASE_URL: API,
    ...emulatorEnv(),
  };
  for (const [name, port] of Object.entries({ api: P.api, broker: P.tcp, hub: P.lan })) {
    if (await tcpOpen(port)) throw new Error(`port ${port} (${name}) already in use — stop the previous smoke run`);
  }

  // 1. emulators + api + broker in parallel
  let emu = null;
  let emuReadyAt = T0;
  if (!(await tcpOpen(EMU.firestore))) {
    emu = emulatorsProc({ quiet: !verbose });
    children.push(emu);
  } else info('emulators already running — reusing');
  const api = startProc('api', process.execPath, [tsx, 'src/main.ts'], {
    cwd: join(repoRoot, 'apps', 'api'),
    env: cleanEnv({ ...env, PORT: String(P.api), HOST: '127.0.0.1' }),
    quiet: !verbose,
  });
  const broker = startProc('broker', process.execPath, [tsx, 'src/cli.ts'], {
    cwd: join(repoRoot, 'tools', 'dev-cloud-broker'),
    env: cleanEnv({ ...env, DEV_API_URL: API, DEV_BROKER_TCP_PORT: String(P.tcp), DEV_BROKER_WS_PORT: String(P.ws) }),
    quiet: !verbose,
  });
  children.push(api, broker);
  // the hub asks the api for a claim code (Firestore write) right at boot → start it once both are up;
  // the dev broker is only needed after the claim, so it keeps starting in parallel
  const brokerReady = waitTcp(P.tcp, { name: 'dev-cloud-broker', timeoutMs: 30_000, child: broker });
  brokerReady.catch(() => {});
  await Promise.all([
    waitTcp(EMU.firestore, { name: 'firestore emulator', timeoutMs: 180_000, child: emu ?? undefined }).then(() =>
      waitTcp(EMU.auth, { name: 'auth emulator', timeoutMs: 30_000, child: emu ?? undefined }).then(() => (emuReadyAt = Date.now())),
    ),
    waitTcp(P.api, { name: 'api', timeoutMs: 30_000, child: api }),
  ]);
  ok('emulators + api up');

  // 2. hub-agent (mock Z2M) on its own ports / data dir
  mkdirSync(dataDir, { recursive: true });
  const cfgFile = join(dataDir, 'config.yaml');
  writeFileSync(
    cfgFile,
    [
      `dataDir: ${JSON.stringify(dataDir)}`,
      `apiBaseUrl: ${API}`,
      'lan:',
      '  bind: 127.0.0.1',
      `  port: ${P.lan}`,
      'mqttLocal:',
      `  port: ${P.mqtt}`,
      `  wsPort: ${P.mqttWs}`,
      '',
    ].join('\n'),
  );
  const hub = startProc('hub', process.execPath, [tsx, 'src/main.ts'], {
    cwd: join(repoRoot, 'apps', 'hub-agent'),
    env: cleanEnv({ ...env, DN_MOCK_Z2M: '1', DN_CONFIG: cfgFile, DN_DATA_DIR: dataDir, DN_MOCK_Z2M_LATENCY_MS: '20', DN_MOCK_AUTO_INTERVIEW_MS: '300' }),
    quiet: !verbose,
    onLine: (l) => hubLog.push(l),
  });
  children.push(hub);

  // 3. user: signUp → bootstrap → fresh ID token with tenant claims (in parallel with hub boot)
  const email = `smoke-${Date.now()}@example.com`;
  const password = 'smoke-pass-123';
  const authUrl = (op) => `http://127.0.0.1:${EMU.auth}/identitytoolkit.googleapis.com/v1/accounts:${op}?key=demo-key`;
  const su = await http('POST', authUrl('signUp'), { email, password, returnSecureToken: true });
  if (su.status !== 200) throw new Error(`signUp HTTP ${su.status}: ${JSON.stringify(su.body)}`);
  const hz = await http('GET', `${API}/healthz`);
  if (hz.status !== 200 || hz.body?.ok !== true) throw new Error(`api /healthz → ${hz.status}`);
  ok('api /healthz ok');
  const boot = await http('POST', `${API}/v1/tenants/bootstrap`, {}, { authorization: `Bearer ${su.body.idToken}` });
  if (boot.status !== 200 && boot.status !== 201) throw new Error(`bootstrap HTTP ${boot.status}: ${JSON.stringify(boot.body)}`);
  const { tenantId, siteId } = boot.body;
  const si = await http('POST', authUrl('signInWithPassword'), { email, password, returnSecureToken: true });
  const idToken = si.body.idToken;
  ok(`user bootstrapped (tenant ${tenantId})`);

  // 4. hub claim code from /setup
  await waitTcp(P.lan, { name: 'hub-agent LAN', timeoutMs: 30_000, child: hub });
  const code = await until('claim code on /setup', async () => {
    const r = await fetch(`${HUB}/setup`, { signal: AbortSignal.timeout(2000) });
    return /id="code">([A-Z0-9]{8})</.exec(await r.text())?.[1];
  });
  ok(`hub shows claim code ${code}`);

  // 5. app MQTT client on the cloud broker (watch for status before claiming)
  await brokerReady;
  const app = await mqtt.connectAsync(`mqtt://127.0.0.1:${P.tcp}`, { clientId: `smoke-app-${process.pid}`, reconnectPeriod: 0 });
  clients.push(app);
  await app.subscribeAsync(`t/${tenantId}/#`, { qos: 1 });
  if (verbose) app.on('message', (tp, b) => process.stdout.write(`[app] ${tp.split('/').slice(4).join('/')} ${b.toString().slice(0, 160)}
`));

  const claim = await http('POST', `${API}/v1/hubs/claim`, { code, siteId, name: 'Hub smoke' }, { authorization: `Bearer ${idToken}` });
  if (claim.status !== 200 && claim.status !== 201) throw new Error(`claim HTTP ${claim.status}: ${JSON.stringify(claim.body)}`);
  const hubId = claim.body.hubId;
  ok(`claimed via api (hub ${hubId})`);
  const base = `t/${tenantId}/h/${hubId}`;

  await waitMsg(app, `${base}/status`, (m) => m.online === true, 10_000, 'hub status online on cloud broker');
  ok('hub status online:true on cloud broker');

  await until(
    'Firestore hubs.online=true (webhook mirror)',
    async () => (await fsGet(`tenants/${tenantId}/hubs/${hubId}`))?.fields?.online?.booleanValue === true,
    8000,
  );
  ok('webhook mirrored hubs.online=true in Firestore');

  const h = await http('GET', `${HUB}/api/health`);
  if (h.body?.claimed !== true || h.body?.mqttCloud !== true) throw new Error(`hub /api/health: ${JSON.stringify(h.body)}`);
  ok(`hub /api/health claimed, mqttCloud, z2m=${h.body.z2m}`);

  // 6. pairing.start → mock interview → device.found
  const cmdId = `cmd_${ulid()}`;
  const foundP = waitMsg(app, `${base}/events`, (m) => m.type === 'device.found', 10_000, 'device.found event');
  const ackP = waitMsg(app, `${base}/cmd/ack`, (m) => m.id === cmdId, 5000, 'pairing.start ack');
  app.publish(`${base}/cmd`, JSON.stringify({ v: 1, id: cmdId, sentAt: Date.now(), cmd: { type: 'pairing.start', seconds: 60 } }), { qos: 1 });
  const ack = (await ackP).msg;
  if (!ack.ok) throw new Error(`pairing.start ack: ${JSON.stringify(ack)}`);
  ok('pairing.start acked');
  const deviceId = (await foundP).msg.deviceId;
  ok(`mock interview → device.found ${deviceId}`);

  await until('device doc in Firestore', async () => !!(await fsGet(`tenants/${tenantId}/devices/${deviceId}`)), 8000);
  ok('device doc created in Firestore');

  // 7. set state:true via cloud broker → retained state true
  const stateTopic = `${base}/d/${deviceId}/state`;
  const onP = waitMsg(app, stateTopic, (m) => m.values?.state === true, 3000, 'state true after set (cloud)');
  app.publish(`${base}/d/${deviceId}/set`, JSON.stringify({ v: 1, values: { state: true }, by: 'smoke' }), { qos: 1 });
  await onP;
  ok('set state:true → new state within 3 s (cloud)');
  const retained = await mqtt.connectAsync(`mqtt://127.0.0.1:${P.tcp}`, { clientId: `smoke-ret-${process.pid}`, reconnectPeriod: 0 });
  clients.push(retained);
  const retP = waitMsg(retained, stateTopic, (m) => m.values?.state === true, 3000, 'retained state true');
  await retained.subscribeAsync(stateTopic, { qos: 1 });
  await retP;
  ok('retained state true');

  // 8. same via LAN ws broker (anonymous, ACL-restricted)
  const lanApp = await mqtt.connectAsync(`ws://127.0.0.1:${P.mqttWs}`, { clientId: `smoke-lan-${process.pid}`, reconnectPeriod: 0 });
  clients.push(lanApp);
  await lanApp.subscribeAsync(`t/${tenantId}/#`, { qos: 1 });
  const offP = waitMsg(lanApp, stateTopic, (m) => m.values?.state === false, 3000, 'state false after set (LAN ws)');
  lanApp.publish(`${base}/d/${deviceId}/set`, JSON.stringify({ v: 1, values: { state: false }, by: 'lan' }), { qos: 1 });
  await offP;
  ok('LAN ws set state:false → new state within 3 s');

  // 9. hard-kill the hub → broker LWT → webhook → hubs.online=false (quickstart step 7)
  await killTree(hub);
  await until(
    'Firestore hubs.online=false after hub kill (LWT mirror)',
    async () => (await fsGet(`tenants/${tenantId}/hubs/${hubId}`))?.fields?.online?.booleanValue === false,
    6000,
  );
  ok('hub killed → LWT → hubs.online=false');

  // 10. (--full) restart with the same data dir: claimed path from credentials.json, device re-seeded in the mock
  if (full) {
    const restartAt = Date.now();
    const onlineAgain = waitMsg(app, `${base}/status`, (m) => m.online === true, 15_000, 'status online after restart');
    // the registry boots devices offline until Z2M availability arrives; the app waits for online like this
    const devOnline = waitMsg(app, stateTopic, (m) => m.online === true, 15_000, 'device online after restart');
    const hub2 = startProc('hub', process.execPath, [tsx, 'src/main.ts'], {
      cwd: join(repoRoot, 'apps', 'hub-agent'),
      env: cleanEnv({ ...env, DN_MOCK_Z2M: '1', DN_CONFIG: cfgFile, DN_DATA_DIR: dataDir, DN_MOCK_Z2M_LATENCY_MS: '20' }),
      quiet: !verbose,
      onLine: (l) => hubLog.push(l),
    });
    children.push(hub2);
    await onlineAgain;
    await devOnline;
    const reOn = waitMsg(app, stateTopic, (m) => m.values?.state === true, 5000, 'state true after restart');
    app.publish(`${base}/d/${deviceId}/set`, JSON.stringify({ v: 1, values: { state: true }, by: 'smoke' }), { qos: 1 });
    await reOn;
    ok('restart → online again (no re-claim), device still controllable');
    restartMs = Date.now() - restartAt;
  }

  // The budget excludes a cold Firebase emulator boot (JVM, 10–30 s depending on machine load);
  // with emulators already running (`pnpm dev`) it is the plain wall-clock time.
  const total = Date.now() - T0;
  const gated = (emu ? Date.now() - emuReadyAt : total) - restartMs;
  if (gated > BUDGET_MS) throw new Error(`smoke took ${gated} ms (> ${BUDGET_MS} ms budget)`);
  const extra = emu ? ` (${(gated / 1000).toFixed(1)} s after the emulators were up)` : '';
  process.stdout.write(`\n\x1b[32mSMOKE PASS\x1b[0m in ${(total / 1000).toFixed(1)} s${extra}\n`);
  exitCode = 0;
} catch (e) {
  process.stdout.write(`\n\x1b[31m✘ SMOKE FAIL\x1b[0m (${t()}): ${e.message}\n`);
  if (!verbose && hubLog.length) {
    process.stdout.write('--- last hub-agent log lines ---\n' + hubLog.slice(-25).join('\n') + '\n');
  }
} finally {
  clearTimeout(watchdog);
  await cleanup();
  process.exit(exitCode);
}
