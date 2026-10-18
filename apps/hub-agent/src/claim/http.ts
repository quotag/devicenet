import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';

export interface JsonResponse {
  status: number;
  /** parsed JSON body, or undefined when empty / not JSON */
  body: unknown;
}

export interface JsonRequest {
  method: 'GET' | 'POST';
  url: string;
  body?: unknown;
  headers?: Record<string, string>;
  timeoutMs?: number;
}

export type HttpJson = (req: JsonRequest) => Promise<JsonResponse>;

/**
 * Minimal JSON client on node:http/https. Deliberately ignores HTTP(S)_PROXY env: the hub talks
 * directly to the api (127.0.0.1 in dev, Cloud Run in prod) — a corporate proxy must not intercept.
 */
export const httpJson: HttpJson = (req) =>
  new Promise((resolve, reject) => {
    const u = new URL(req.url);
    const payload = req.body === undefined ? undefined : Buffer.from(JSON.stringify(req.body));
    const headers: Record<string, string | number> = { accept: 'application/json', ...req.headers };
    if (payload) {
      headers['content-type'] = 'application/json';
      headers['content-length'] = payload.length;
    }
    const fn = u.protocol === 'https:' ? httpsRequest : httpRequest;
    const r = fn(u, { method: req.method, headers, agent: false }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('error', reject);
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        let body: unknown;
        try {
          body = text ? JSON.parse(text) : undefined;
        } catch {
          body = undefined;
        }
        resolve({ status: res.statusCode ?? 0, body });
      });
    });
    r.setTimeout(req.timeoutMs ?? 10_000, () => r.destroy(new Error(`timeout ${req.method} ${u.pathname}`)));
    r.on('error', reject);
    r.end(payload);
  });
