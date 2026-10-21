import { auth } from '../firebase.js';
import { getConfig } from '../config.js';

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
  firebase?: { projectId: string; apiKey: string };
}

/** MQTT endpoint & credentials from config; dev defaults = tools/dev-cloud-broker. */
export function buildCredential(p: {
  tenantId: string;
  hubId: string;
  siteId: string;
  secret: string;
  customToken: string;
}): HubCredential {
  const cfg = getConfig();
  return {
    tenantId: p.tenantId,
    hubId: p.hubId,
    siteId: p.siteId,
    mqtt: {
      host: cfg.mqttHost,
      port: cfg.mqttPort,
      wssPort: cfg.mqttWssPort,
      username: `hub:${p.hubId}`,
      password: p.secret,
    },
    firebaseCustomToken: p.customToken,
    apiBaseUrl: cfg.apiBaseUrl,
    firebase: {
      projectId: cfg.projectId,
      apiKey: cfg.firebaseWebApiKey,
    },
  };
}
