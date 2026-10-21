import { getConfig } from '../config.js';

let warnedMissingConfig = false;

/** EMQX REST admin (v5). Skipped when EMQX_ADMIN_URL is unset. Never throws. */
export async function kickClient(
  clientId: string,
  log?: { warn: (o: unknown, m?: string) => void },
): Promise<boolean> {
  const cfg = getConfig();
  const base = cfg.emqxAdminUrl ?? process.env.EMQX_ADMIN_URL;
  if (!base) {
    if (!warnedMissingConfig) {
      warnedMissingConfig = true;
      log?.warn({ base: Boolean(base) }, 'emqx admin url not configured; kick client disabled');
    }
    return false;
  }
  try {
    const key = cfg.emqxAdminKey ?? process.env.EMQX_ADMIN_KEY;
    const secret = cfg.emqxAdminSecret ?? process.env.EMQX_ADMIN_SECRET;
    const headers: Record<string, string> = {
      'x-dn-token': cfg.emqxSharedToken ?? process.env.EMQX_SHARED_TOKEN ?? '',
    };
    if (key && secret) headers.authorization = `Basic ${Buffer.from(`${key}:${secret}`).toString('base64')}`;
    else if (key) headers.authorization = `Bearer ${key}`;
    const r = await fetch(`${base.replace(/\/$/, '')}/api/v5/clients/${encodeURIComponent(clientId)}`, {
      method: 'DELETE',
      headers,
      signal: AbortSignal.timeout(3000),
    });
    if (!r.ok && r.status !== 404) {
      log?.warn({ status: r.status }, 'emqx kick failed');
      return false;
    }
    return true;
  } catch (e) {
    log?.warn({ err: String(e) }, 'emqx kick error');
    return false;
  }
}
