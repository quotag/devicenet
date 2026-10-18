/** EMQX REST admin (v5). Skipped when EMQX_ADMIN_URL is unset. Never throws. */
export async function kickClient(
  clientId: string,
  log?: { warn: (o: unknown, m?: string) => void },
): Promise<boolean> {
  const base = process.env.EMQX_ADMIN_URL;
  if (!base) return false;
  try {
    const key = process.env.EMQX_ADMIN_KEY;
    const secret = process.env.EMQX_ADMIN_SECRET;
    const headers: Record<string, string> = {};
    if (key && secret) headers.authorization = `Basic ${Buffer.from(`${key}:${secret}`).toString('base64')}`;
    else if (key) headers.authorization = `Bearer ${key}`;
    const r = await fetch(`${base.replace(/\/$/, '')}/api/v5/clients/${encodeURIComponent(clientId)}`, {
      method: 'DELETE',
      headers,
      signal: AbortSignal.timeout(5000),
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
