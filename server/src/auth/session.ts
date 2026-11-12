// STUB — à implémenter par l'agent "auth". Contrat :
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { User } from '@backupviiz/shared';

declare module 'fastify' {
  interface FastifyInstance { requireAuth: (req: FastifyRequest, reply: FastifyReply) => Promise<void>; }
  interface FastifyRequest { user?: User; }
}
export async function sessionPlugin(_app: FastifyInstance): Promise<void> {}
