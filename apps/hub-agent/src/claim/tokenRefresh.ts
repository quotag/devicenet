import { z } from 'zod';
import { readCredentials, updateToken, type HubCredential } from './credentials.js';
import { httpJson, type HttpJson } from './http.js';

const TokenResponse = z.object({ firebaseCustomToken: z.string().min(1) });

export class TokenRefreshError extends Error {
  constructor(
    message: string,
    readonly status?: number,
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
  if (!body?.success) throw new TokenRefreshError(`token refresh HTTP ${res.status}`, res.status);
  return updateToken(opts.credentialsPath, body.data.firebaseCustomToken);
}
