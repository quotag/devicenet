import { z } from 'zod';
import { readCredentials, updateToken, type HubCredential } from './credentials.js';
import { httpJson, type HttpJson } from './http.js';

const TokenResponse = z.object({ firebaseCustomToken: z.string().min(1) });

export class TokenRefreshError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly code?: string,
  ) {
    super(message);
    this.name = 'TokenRefreshError';
  }
}

/**
 * OQ-5: on any custom-token sign-in failure the sync layer calls this — `POST /v1/hubs/{id}/token`
 * with `Authorization: Hub <hubId>:<secret>` (secret = mqtt.password), persist the new token.
 * Returns the updated credential.
 */
export async function refreshHubToken(opts: { credentialsPath: string; http?: HttpJson }): Promise<HubCredential> {
  const cred = readCredentials(opts.credentialsPath);
  if (!cred) throw new TokenRefreshError('hub is not claimed');
  const res = await (opts.http ?? httpJson)({
    method: 'POST',
    url: `${cred.apiBaseUrl}/v1/hubs/${cred.hubId}/token`,
    headers: { authorization: `Hub ${cred.hubId}:${cred.mqtt.password}` },
    body: {},
  });
  const body = res.status === 200 ? TokenResponse.safeParse(res.body) : null;
  if (!body?.success) {
    const errCode = (res.body as { error?: { code?: string } } | undefined)?.error?.code;
    throw new TokenRefreshError(`token refresh HTTP ${res.status}`, res.status, errCode);
  }
  return updateToken(opts.credentialsPath, body.data.firebaseCustomToken);
}

export interface UnclaimDecision {
  shouldUnclaim: boolean;
  consecutiveFailures: number;
  isUnauthenticated: boolean;
  retryDelayMs: number;
}

/**
 * Task 4.3: Only unclaim when receiving ≥ 3 consecutive 401 UNAUTHENTICATED or 404 HUB_NOT_FOUND
 * responses from our API, with interval ≥ 30s. Transient network errors, 5xx, or HTML 404s
 * do not increment unauthenticated failures and never trigger unclaim.
 */
export function evaluateSignInError(
  err: unknown,
  currentCount: number,
  currentDelay = 5_000,
): UnclaimDecision {
  const status = (err as { status?: number })?.status;
  const code = (err as { code?: string })?.code;
  const isUnauthenticated =
    (status === 401 && code === 'UNAUTHENTICATED') ||
    (status === 404 && code === 'HUB_NOT_FOUND');

  if (isUnauthenticated) {
    const nextCount = currentCount + 1;
    return {
      shouldUnclaim: nextCount >= 3,
      consecutiveFailures: nextCount,
      isUnauthenticated: true,
      retryDelayMs: Math.max(currentDelay, 30_000),
    };
  }

  return {
    shouldUnclaim: false,
    consecutiveFailures: currentCount,
    isUnauthenticated: false,
    retryDelayMs: Math.min(currentDelay * 2, 60_000),
  };
}
