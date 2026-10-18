import { randomBytes } from 'node:crypto';
export { sha256Hex } from '../auth/hubAuth.js';

/** Hub MQTT/API secret: 32 random bytes, base64url (no padding, 43 chars). */
export const newHubSecret = (): string => randomBytes(32).toString('base64url');
