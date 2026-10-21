import { timingSafeEqual } from 'node:crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { sendError } from '../errors.js';
import { getConfig } from '../config.js';

/** preHandler: `X-EMQX-Token` must equal env EMQX_SHARED_TOKEN. */
export async function emqxToken(req: FastifyRequest, reply: FastifyReply) {
  const expected = getConfig().emqxSharedToken;
  const given = req.headers['x-emqx-token'];
  if (!expected || typeof given !== 'string') return sendError(reply, 401, 'UNAUTHENTICATED', 'bad token');
  const a = Buffer.from(expected);
  const b = Buffer.from(given);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return sendError(reply, 401, 'UNAUTHENTICATED', 'bad token');
}
