import { createReadStream, existsSync, statSync } from 'node:fs';
import { extname, join, normalize, resolve, sep } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { S } from '../strings.vi.js';

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.txt': 'text/plain; charset=utf-8',
  '.map': 'application/json',
};

const isFile = (p: string) => existsSync(p) && statSync(p).isFile();

/** Static serve of the LAN web build with SPA fallback; missing dir → plain notice page. */
export function staticRoute(app: FastifyInstance, webDir: string): void {
  const root = resolve(webDir);
  app.get('/*', async (req, reply) => {
    let path: string;
    try {
      path = decodeURIComponent(req.url.split('?')[0] ?? '/');
    } catch {
      return reply.code(400).send({ error: 'bad_request' });
    }
    if (path.startsWith('/api/') || path === '/api') return reply.code(404).send({ error: 'not_found' });
    if (!isFile(join(root, 'index.html'))) {
      return reply
        .code(200)
        .type('text/html; charset=utf-8')
        .send(
          `<!doctype html><html lang="vi"><head><meta charset="utf-8"><title>${S.webNotBuilt}</title></head><body><h1>${S.webNotBuilt}</h1><p>${S.webNotBuiltHint}</p></body></html>`,
        );
    }
    let file = normalize(join(root, path));
    if (file !== root && !file.startsWith(root + sep)) return reply.code(403).send({ error: 'forbidden' });
    if (!isFile(file)) {
      if (extname(path)) return reply.code(404).send({ error: 'not_found' });
      file = join(root, 'index.html');
    }
    const ext = extname(file).toLowerCase();
    return reply.type(MIME[ext] ?? 'application/octet-stream').send(createReadStream(file));
  });
}
