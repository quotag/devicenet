import type { FastifyReply } from 'fastify';

export class ApiError extends Error {
  constructor(public status: number, public code: string, message?: string) {
    super(message ?? code);
  }
}

export function sendError(reply: FastifyReply, status: number, code: string, message: string) {
  return reply.status(status).send({ error: { code, message } });
}

export const notImplemented = (reply: FastifyReply) =>
  sendError(reply, 501, 'NOT_IMPLEMENTED', 'not implemented yet');
