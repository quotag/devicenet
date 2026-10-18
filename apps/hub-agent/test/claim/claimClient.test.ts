import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ClaimClient, type ClaimClientOptions } from '../../src/claim/claimClient.js';
import { readCredentials, writeCredentials, type HubCredential } from '../../src/claim/credentials.js';
import type { HttpJson, JsonRequest } from '../../src/claim/http.js';
import { FakeTime } from '../../src/core/clock.js';
import { makeCredential, silentLog, StubApi, waitFor } from './helpers.js';

let api: StubApi | undefined;
let client: ClaimClient | undefined;
afterEach(async () => {
  client?.stop();
  await api?.close();
  api = client = undefined;
});

function mk(over: Partial<ClaimClientOptions> = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'claim-'));
  const lines: string[] = [];
  const log = { ...silentLog, info: (_o: unknown, msg?: string) => void (msg && lines.push(msg)) };
  const opts: ClaimClientOptions = {
    apiBaseUrl: api?.url ?? 'http://127.0.0.1:9',
    hubKeyPath: join(dir, 'hub.key'),
    credentialsPath: join(dir, 'credentials.json'),
    agentVersion: '0.0.1',
    platform: 'windows',
    log,
    retryMs: 20,
    retryMaxMs: 80,
    ...over,
  };
  client = new ClaimClient(opts);
  return { client, opts, lines, dir };
}

describe('ClaimClient (stub api)', () => {
  it('requests a code, polls, decrypts, saves credentials and emits claimed without restart', async () => {
    api = await new StubApi().start();
    const { client, opts, lines } = mk();
    const claimed: HubCredential[] = [];
    client.on('claimed', (c) => claimed.push(c));
    expect(await client.start()).toBeNull();
    await waitFor(() => client.state === 'waiting');
    const req = api.codes[0]!;
    expect(req.platform).toBe('windows');
    expect(req.agentVersion).toBe('0.0.1');
    expect(req.hubPubKey).toBe(JSON.parse(readFileSync(opts.hubKeyPath, 'utf8')).pk);
    expect(lines.some((l) => /^CLAIM CODE: ABCDEF22 \(hết hạn \d\d:\d\d\)$/.test(l))).toBe(true);
    expect(client.current()).toMatchObject({ claimed: false, code: 'ABCDEF22' });
    await waitFor(() => api!.polls.length >= 2);

    const cred = makeCredential(api.url);
    await api.claim('ABCDEF22', cred);
    await waitFor(() => claimed.length === 1);
    expect(claimed[0]).toEqual(cred);
    expect(client.state).toBe('claimed');
    expect(client.current()).toEqual({ claimed: true });
    expect(readCredentials(opts.credentialsPath)).toEqual(cred);
    const polls = api.polls.length;
    await new Promise((r) => setTimeout(r, 80));
    expect(api.polls.length).toBe(polls);
  });

  it('gets a new code on 410', async () => {
    api = await new StubApi().start();
    const { client } = mk();
    await client.start();
    await waitFor(() => client.current().code === 'ABCDEF22');
    api.gone.add('ABCDEF22');
    await waitFor(() => client.current().code === 'ABCDEF32');
    expect(api.codes).toHaveLength(2);
    expect(api.codes[1]!.hubPubKey).toBe(api.codes[0]!.hubPubKey);
  });

  it('gets a new code when the current one expires', async () => {
    api = await new StubApi().start();
    api.ttlMs = 60;
    const { client } = mk();
    await client.start();
    await waitFor(() => api!.codes.length >= 3);
    expect(client.current().claimed).toBe(false);
  });

  it('retries claim-codes with backoff after errors', async () => {
    api = await new StubApi().start();
    api.failNextCodes = 2;
    const { client } = mk();
    await client.start();
    await waitFor(() => client.state === 'waiting');
    expect(client.current().code).toBe('ABCDEF22');
  });

  it('starts over with a new code when the credential is unusable', async () => {
    api = await new StubApi().start();
    const { client, opts } = mk();
    await client.start();
    await waitFor(() => client.state === 'waiting');
    await api.claim('ABCDEF22', '{"not":"a credential"}');
    await waitFor(() => client.current().code === 'ABCDEF32');
    expect(readCredentials(opts.credentialsPath)).toBeNull();
  });

  it('is claimed immediately when credentials.json exists (no api calls)', async () => {
    api = await new StubApi().start();
    const { client, opts } = mk();
    const cred = makeCredential(api.url);
    writeCredentials(opts.credentialsPath, cred);
    expect(await client.start()).toEqual(cred);
    expect(client.current()).toEqual({ claimed: true });
    expect(api.codes).toHaveLength(0);
  });

  it('stop() halts polling', async () => {
    api = await new StubApi().start();
    const { client } = mk();
    await client.start();
    await waitFor(() => api!.polls.length >= 1);
    client.stop();
    const n = api.polls.length;
    await new Promise((r) => setTimeout(r, 80));
    expect(api.polls.length).toBeLessThanOrEqual(n + 1);
    expect(client.state).toBe('stopped');
  });
});

describe('ClaimClient timing (fake time)', () => {
  const flush = async () => {
    for (let i = 0; i < 20; i++) await new Promise((r) => setImmediate(r));
  };

  it('polls every pollEverySec (3 s) and renews at 15 min', async () => {
    const t = new FakeTime(1_000_000);
    const calls: { at: number; req: JsonRequest }[] = [];
    let n = 0;
    const http: HttpJson = async (req) => {
      calls.push({ at: t.now(), req });
      if (req.method === 'POST') {
        n++;
        return { status: 201, body: { code: n === 1 ? 'ABCDEFGH' : 'ZZZZZZZZ', expiresAt: t.now() + 15 * 60_000, pollEverySec: 3 } };
      }
      return { status: 404, body: undefined };
    };
    const { client } = mk({ http, clock: t, timers: t });
    await client.start();
    await flush();
    expect(calls).toHaveLength(1);
    for (let i = 0; i < 3; i++) {
      t.advance(3000);
      await flush();
    }
    const gets = calls.filter((c) => c.req.method === 'GET');
    expect(gets.map((c) => c.at - 1_000_000)).toEqual([3000, 6000, 9000]);
    expect(gets[0]!.req.url).toMatch(/\/v1\/hubs\/claim-codes\/ABCDEFGH\/credential$/);
    for (let i = 0; i < 300; i++) {
      t.advance(3000);
      await flush();
    }
    const posts = calls.filter((c) => c.req.method === 'POST');
    expect(posts).toHaveLength(2);
    expect(posts[1]!.at - 1_000_000).toBe(15 * 60_000);
    expect(client.current().code).toBe('ZZZZZZZZ');
  });
});
