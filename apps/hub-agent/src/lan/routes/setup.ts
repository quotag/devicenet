import QRCode from 'qrcode';
import type { FastifyInstance } from 'fastify';
import { S } from '../strings.vi.js';
import type { LanDeps } from '../server.js';

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

export function setupRoute(app: FastifyInstance, deps: LanDeps): void {
  app.post('/setup/reset', async (_req, reply) => {
    let ok = true;
    if (deps.resetClaim) {
      const res = await deps.resetClaim();
      if (res === false) ok = false;
    }
    const query = ok ? '' : '?cloudError=1';
    return reply.redirect(`/setup${query}`, 303);
  });

  app.get<{ Querystring: { cloudError?: string } }>('/setup', async (req, reply) => {
    const now = (deps.now ?? Date.now)();
    const st = deps.getClaim();
    const hasCloudError = req.query?.cloudError === '1';
    const errorBanner = hasCloudError
      ? `<div class="warning" id="cloud-warning">${esc(S.cloudUnclaimFailed)}</div>`
      : '';
    let body: string;
    if (st.claimed) {
      const resetForm = deps.resetClaim
        ? `<form method="POST" action="/setup/reset" onsubmit="return confirm('${esc(S.resetConfirm)}')"><button type="submit" class="btn-reset" id="reset-btn">${esc(S.resetButton)}</button></form>`
        : '';
      body = `${errorBanner}<p id="state">${S.claimed}</p>${resetForm}`;
    } else if (!st.code) {
      body = `${errorBanner}<p id="state">${S.noCode}</p>`;
    } else if (st.expiresAt !== undefined && st.expiresAt <= now) {
      body = `${errorBanner}<p id="state">${S.expired}</p>`;
    } else {
      const svg = await QRCode.toString(`devicenet://claim?code=${st.code}`, { type: 'svg', margin: 1 });
      const exp =
        st.expiresAt !== undefined
          ? `<p>${S.expiresAt}: <time datetime="${new Date(st.expiresAt).toISOString()}">${esc(new Date(st.expiresAt).toLocaleString('vi-VN'))}</time></p>`
          : '';
      body = `${errorBanner}<p>${S.setupIntro}</p><div class="qr">${svg}</div><p>${S.codeLabel}</p><p class="code" id="code">${esc(st.code)}</p>${exp}`;
    }
    const html = `<!doctype html><html lang="vi"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${S.setupTitle}</title><style>body{font-family:system-ui,sans-serif;max-width:28rem;margin:2rem auto;padding:0 1rem;text-align:center}.qr svg{width:14rem;height:14rem}.code{font-size:2.2rem;letter-spacing:.2em;font-weight:700;font-family:ui-monospace,monospace}.btn-reset{margin-top:1.5rem;padding:0.6rem 1.2rem;background:#e02424;color:#fff;border:0;border-radius:8px;font-size:0.95rem;font-weight:500;cursor:pointer}.btn-reset:hover{background:#b91c1c}.warning{background:#fef2f2;border:1px solid #f87171;color:#b91c1c;padding:0.75rem 1rem;border-radius:8px;margin-bottom:1rem;font-size:0.9rem}</style></head><body><h1>${S.setupTitle}</h1>${body}</body></html>`;
    return reply.header('Cache-Control', 'no-store').type('text/html; charset=utf-8').send(html);
  });
}
