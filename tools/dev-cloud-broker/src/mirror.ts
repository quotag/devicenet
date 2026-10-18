import { request } from 'node:http';

export interface MirrorOptions {
  webhookUrl: string;
  token: string;
  retries?: number;
  retryDelayMs?: number;
  log?: (msg: string) => void;
}

const STATUS_RE = /^t\/[^/]+\/h\/[^/]+\/status$/;
export const isStatusTopic = (topic: string): boolean => STATUS_RE.test(topic);

/** One POST with no proxy (node:http never uses env proxies). Resolves with HTTP status. */
function postOnce(url: string, token: string, body: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const req = request(
      url,
      { method: 'POST', headers: { 'content-type': 'application/json', 'x-emqx-token': token, 'content-length': Buffer.byteLength(body) } },
      (res) => {
        res.resume();
        res.on('end', () => resolve(res.statusCode ?? 0));
      },
    );
    req.on('error', reject);
    req.end(body);
  });
}

/** Mirror a publish to the webhook; retries on ECONNREFUSED. Empty payloads are skipped. */
export async function mirrorStatus(topic: string, payload: Buffer | string, opts: MirrorOptions): Promise<boolean> {
  if (!isStatusTopic(topic)) return false;
  const text = typeof payload === 'string' ? payload : payload.toString('utf8');
  if (text.length === 0) return false;
  const body = JSON.stringify({ topic, payload: text, publish_received_at: Date.now() });
  const retries = opts.retries ?? 3;
  for (let attempt = 0; ; attempt++) {
    try {
      const status = await postOnce(opts.webhookUrl, opts.token, body);
      if (status >= 400) opts.log?.(`webhook ${topic} -> ${status}`);
      return true;
    } catch (e) {
      const code = (e as NodeJS.ErrnoException).code;
      if (code === 'ECONNREFUSED' && attempt < retries) {
        await new Promise((r) => setTimeout(r, opts.retryDelayMs ?? 500));
        continue;
      }
      opts.log?.(`webhook ${topic} failed: ${(e as Error).message}`);
      return false;
    }
  }
}
