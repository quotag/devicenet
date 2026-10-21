import { existsSync, mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { readCredentials, updateToken, writeCredentials } from '../../src/claim/credentials.js';
import { evaluateSignInError, refreshHubToken, TokenRefreshError } from '../../src/claim/tokenRefresh.js';
import { runCli } from '../../src/cli.js';
import { makeCredential, StubApi } from './helpers.js';

const tmp = () => mkdtempSync(join(tmpdir(), 'claim-cred-'));

describe('credentials.json', () => {
  it('round-trips, validates and updates the token', () => {
    const p = join(tmp(), 'credentials.json');
    expect(readCredentials(p)).toBeNull();
    const c = makeCredential('http://127.0.0.1:3000');
    writeCredentials(p, c);
    if (process.platform !== 'win32') expect(statSync(p).mode & 0o777).toBe(0o600);
    expect(readCredentials(p)).toEqual(c);
    expect(updateToken(p, 'tok-new').firebaseCustomToken).toBe('tok-new');
    expect(readCredentials(p)).toEqual({ ...c, firebaseCustomToken: 'tok-new' });
    expect(() => writeCredentials(p, { ...c, hubId: 'nope' })).toThrow();
    writeFileSync(p, JSON.stringify({ hubId: 'x' }));
    expect(() => readCredentials(p)).toThrow(/invalid/);
  });
});

describe('token refresh (OQ-5)', () => {
  let api: StubApi | undefined;
  afterEach(async () => {
    await api?.close();
    api = undefined;
  });

  it('POSTs /v1/hubs/{id}/token with Hub auth and persists the new token', async () => {
    api = await new StubApi().start();
    const p = join(tmp(), 'credentials.json');
    writeCredentials(p, makeCredential(api.url));
    const next = await refreshHubToken({ credentialsPath: p });
    expect(api.tokenCalls).toEqual(['Hub hub_01J0000000000000000000000H:sekret']);
    expect(next.firebaseCustomToken).toBe('tok-2');
    expect(readCredentials(p)!.firebaseCustomToken).toBe('tok-2');
  });

  it('throws TokenRefreshError on 401 and keeps the old token', async () => {
    api = await new StubApi().start();
    const p = join(tmp(), 'credentials.json');
    writeCredentials(p, makeCredential(api.url, { mqtt: { host: 'h', port: 1, wssPort: 2, username: 'u', password: 'wrong' } }));
    await expect(refreshHubToken({ credentialsPath: p })).rejects.toMatchObject({ name: 'TokenRefreshError', status: 401, code: 'UNAUTHENTICATED' });
    expect(readCredentials(p)!.firebaseCustomToken).toBe('tok-1');
    await expect(refreshHubToken({ credentialsPath: join(tmp(), 'none.json') })).rejects.toBeInstanceOf(TokenRefreshError);
  });

  describe('evaluateSignInError (strict unclaim condition)', () => {
    const unauthErr = new TokenRefreshError('token refresh HTTP 401', 401, 'UNAUTHENTICATED');
    const notFoundErr = new TokenRefreshError('token refresh HTTP 404', 404, 'HUB_NOT_FOUND');
    const netErr = new Error('connect ECONNREFUSED 127.0.0.1:443');
    const serverErr = new TokenRefreshError('token refresh HTTP 502', 502);
    const html404 = new TokenRefreshError('token refresh HTTP 404', 404);
    const fake401Msg = new Error('request failed with status code 401 in proxy');

    it('requires 3 consecutive unauthenticated errors before shouldUnclaim is true', () => {
      // 1st time
      const d1 = evaluateSignInError(unauthErr, 0);
      expect(d1.isUnauthenticated).toBe(true);
      expect(d1.consecutiveFailures).toBe(1);
      expect(d1.shouldUnclaim).toBe(false);
      expect(d1.retryDelayMs).toBe(30_000);

      // 2nd time
      const d2 = evaluateSignInError(unauthErr, d1.consecutiveFailures);
      expect(d2.isUnauthenticated).toBe(true);
      expect(d2.consecutiveFailures).toBe(2);
      expect(d2.shouldUnclaim).toBe(false);

      // 3rd time -> unclaim
      const d3 = evaluateSignInError(unauthErr, d2.consecutiveFailures);
      expect(d3.isUnauthenticated).toBe(true);
      expect(d3.consecutiveFailures).toBe(3);
      expect(d3.shouldUnclaim).toBe(true);
    });

    it('treats 404 HUB_NOT_FOUND as unauthenticated rejection', () => {
      const d = evaluateSignInError(notFoundErr, 2);
      expect(d.isUnauthenticated).toBe(true);
      expect(d.shouldUnclaim).toBe(true);
    });

    it('never unclaims on network errors, 5xx, HTML 404, or string 401 matches', () => {
      for (const err of [netErr, serverErr, html404, fake401Msg]) {
        const d = evaluateSignInError(err, 2);
        expect(d.isUnauthenticated).toBe(false);
        expect(d.shouldUnclaim).toBe(false);
      }
    });
  });
});

describe('devicenet-agent reset', () => {
  it('deletes credentials + hub.key, keeps z2m data and hub.db', () => {
    const dataDir = tmp();
    mkdirSync(join(dataDir, 'z2m'));
    for (const f of ['credentials.json', 'hub.key', 'hub.db', join('z2m', 'database.db')]) writeFileSync(join(dataDir, f), 'x');
    const out: string[] = [];
    const code = runCli(['reset', '--data-dir', dataDir], { out: (l) => out.push(l), err: (l) => out.push(l), env: {} });
    expect(code).toBe(0);
    expect(existsSync(join(dataDir, 'credentials.json'))).toBe(false);
    expect(existsSync(join(dataDir, 'hub.key'))).toBe(false);
    expect(readFileSync(join(dataDir, 'hub.db'), 'utf8')).toBe('x');
    expect(existsSync(join(dataDir, 'z2m', 'database.db'))).toBe(true);
    expect(out[0]).toMatch(/đã xóa.*đã xóa/);
    // idempotent
    expect(runCli(['reset'], { out: () => {}, err: () => {}, env: { DN_DATA_DIR: dataDir } })).toBe(0);
  });

  it('returns null for non-CLI argv (normal boot)', () => {
    expect(runCli([])).toBeNull();
    expect(runCli(['--foo'])).toBeNull();
  });
});
