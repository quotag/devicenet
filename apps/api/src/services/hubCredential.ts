import { auth } from '../firebase.js';

/** Firebase custom token for a hub: uid = hubId, claims {tenant, hubId, role:"hub"} (firestore.rules). */
export const mintHubToken = (tenantId: string, hubId: string) =>
  auth().createCustomToken(hubId, { tenant: tenantId, hubId, role: 'hub' });

/** Plaintext of `claimCodes/{code}.credential` (api.openapi.yaml credential description). */
export interface HubCredential {
  tenantId: string;
  hubId: string;
  siteId: string;
  mqtt: { host: string; port: number; wssPort: number; username: string; password: string };
  firebaseCustomToken: string;
  apiBaseUrl: string;
}

const intEnv = (name: string, dflt: number) => {
  const n = Number(process.env[name]);
  return Number.isInteger(n) && n > 0 ? n : dflt;
};

/** MQTT endpoint from env (OQ-8); dev defaults = tools/dev-cloud-broker (tcp 1884, ws 8084). */
export function buildCredential(p: {
  tenantId: string;
  hubId: string;
  siteId: string;
  secret: string;
  customToken: string;
}): HubCredential {
  return {
    tenantId: p.tenantId,
    hubId: p.hubId,
    siteId: p.siteId,
    mqtt: {
      host: process.env.DN_MQTT_HOST || '127.0.0.1',
      port: intEnv('DN_MQTT_PORT', 1884),
      wssPort: intEnv('DN_MQTT_WSS_PORT', 8084),
      username: `hub:${p.hubId}`,
      password: p.secret,
    },
    firebaseCustomToken: p.customToken,
    apiBaseUrl: process.env.DN_API_BASE_URL || 'http://127.0.0.1:3000',
  };
}
