import type { FastifyInstance, FastifyRequest } from 'fastify';
import { randomBytes, randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { ApiTokenInfo } from '@backupviiz/shared';
import { db } from '../db';
import { sha256 } from '../auth/session';

export const MAX_TOKENS_PER_USER = 20;
export const TOKEN_PREFIX = 'bvk_';

interface TokenRow { id: string; name: string; created_at: string; last_used_at: string | null }
const toInfo = (r: TokenRow): ApiTokenInfo => ({ id: r.id, name: r.name, createdAt: r.created_at, lastUsedAt: r.last_used_at });

const createSchema = z.object({ name: z.string().trim().min(1).max(60) });

export default async function tokenRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', app.requireAuth);
  const uid = (req: FastifyRequest): string => req.user!.id;

  app.get('/', async (req) => {
    const rows = db.prepare('SELECT id, name, created_at, last_used_at FROM api_tokens WHERE user_id = ? ORDER BY created_at DESC, rowid DESC').all(uid(req)) as unknown as TokenRow[];
    return rows.map(toInfo);
  });

  app.post('/', async (req, reply) => {
    const { name } = createSchema.parse(req.body ?? {});
    const count = db.prepare('SELECT COUNT(*) AS c FROM api_tokens WHERE user_id = ?').get(uid(req)) as unknown as { c: number };
    if (Number(count.c) >= MAX_TOKENS_PER_USER) {
      throw Object.assign(new Error(`Limite de ${MAX_TOKENS_PER_USER} jetons atteinte`), { statusCode: 409, code: 'conflict' });
    }
    const token = TOKEN_PREFIX + randomBytes(32).toString('base64url');
    const id = randomUUID();
    const createdAt = new Date().toISOString();
    db.prepare('INSERT INTO api_tokens (id, user_id, name, token_hash, created_at) VALUES (?, ?, ?, ?, ?)').run(id, uid(req), name, sha256(token), createdAt);
    return reply.code(201).send({ ...toInfo({ id, name, created_at: createdAt, last_used_at: null }), token });
  });

  app.delete('/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const r = db.prepare('DELETE FROM api_tokens WHERE id = ? AND user_id = ?').run(id, uid(req));
    if (Number(r.changes) === 0) throw Object.assign(new Error('Jeton introuvable'), { statusCode: 404, code: 'not_found' });
    return reply.code(204).send();
  });
}
