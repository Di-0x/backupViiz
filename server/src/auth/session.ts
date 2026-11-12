import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { createHash, randomBytes } from 'node:crypto';
import type { User } from '@backupviiz/shared';
import { db } from '../db';

declare module 'fastify' {
  interface FastifyInstance { requireAuth: (req: FastifyRequest, reply: FastifyReply) => Promise<void>; }
  interface FastifyRequest { user?: User; /** sha256 du token de la session courante (après requireAuth). */ sessionHash?: string; }
}

export const SESSION_COOKIE = 'bv_session';
export const SESSION_TTL_MS = 14 * 24 * 3600 * 1000;
const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export function sendError(reply: FastifyReply, status: number, code: string, message: string, fields?: Record<string, string>) {
  return reply.code(status).send({ error: { code, message, ...(fields ? { fields } : {}) } });
}

export const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

export function isSecure(req: FastifyRequest): boolean {
  const v = process.env.COOKIE_SECURE;
  if (v === 'true') return true;
  if (v === 'false') return false;
  return req.protocol === 'https';
}

export function cookieOpts(req: FastifyRequest, maxAgeMs?: number) {
  return { httpOnly: true, sameSite: 'lax' as const, path: '/', secure: isSecure(req), ...(maxAgeMs ? { maxAge: Math.floor(maxAgeMs / 1000) } : {}) };
}

interface UserRow { id: string; username: string; password_hash: string | null }

export function toUser(row: UserRow): User {
  const c = db.prepare('SELECT COUNT(*) AS c FROM passkeys WHERE user_id = ?').get(row.id) as unknown as { c: number };
  return { id: row.id, username: row.username, hasPassword: row.password_hash != null, passkeyCount: Number(c.c) };
}

export function getUserById(id: string): User | undefined {
  const row = db.prepare('SELECT id, username, password_hash FROM users WHERE id = ?').get(id) as unknown as UserRow | undefined;
  return row ? toUser(row) : undefined;
}

let lastPurge = 0;
/** Supprime sessions et challenges expirés. Retourne le nombre de sessions purgées. */
export function purgeExpired(now = Date.now()): number {
  lastPurge = now;
  db.prepare('DELETE FROM webauthn_challenges WHERE expires_at < ?').run(now);
  return Number(db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(now).changes);
}

export function createSession(req: FastifyRequest, reply: FastifyReply, userId: string): void {
  const now = Date.now();
  if (now - lastPurge > 60_000) purgeExpired(now); // purge opportuniste
  const token = randomBytes(32).toString('base64url');
  db.prepare('INSERT INTO sessions (id_hash, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)').run(sha256(token), userId, now + SESSION_TTL_MS, now);
  reply.setCookie(SESSION_COOKIE, token, cookieOpts(req, SESSION_TTL_MS));
}

export function destroySession(req: FastifyRequest, reply: FastifyReply): void {
  const token = req.cookies?.[SESSION_COOKIE];
  if (token) db.prepare('DELETE FROM sessions WHERE id_hash = ?').run(sha256(token));
  reply.clearCookie(SESSION_COOKIE, { path: '/' });
}

function unauthorized(reply: FastifyReply) {
  return sendError(reply, 401, 'unauthorized', 'Authentification requise');
}

async function sessionPluginImpl(app: FastifyInstance): Promise<void> {
  app.decorateRequest('user', undefined);
  app.decorateRequest('sessionHash', undefined);

  // CSRF : en plus de SameSite=Lax, rejette les requêtes mutantes dont l'Origin (si présent) ≠ host.
  app.addHook('onRequest', async (req, reply) => {
    if (!MUTATING.has(req.method)) return;
    const origin = req.headers.origin;
    if (origin === undefined) return;
    let host: string | null = null;
    try { host = new URL(origin).host; } catch { /* origin invalide */ }
    if (!host || host.toLowerCase() !== (req.host ?? '').toLowerCase()) {
      return sendError(reply, 403, 'csrf', 'Origine de la requête refusée');
    }
  });

  app.decorate('requireAuth', async (req: FastifyRequest, reply: FastifyReply) => {
    const token = req.cookies?.[SESSION_COOKIE];
    if (!token) return unauthorized(reply);
    const idHash = sha256(token);
    const now = Date.now();
    const s = db.prepare('SELECT user_id, expires_at FROM sessions WHERE id_hash = ?').get(idHash) as unknown as { user_id: string; expires_at: number } | undefined;
    if (!s || s.expires_at < now) {
      if (s) db.prepare('DELETE FROM sessions WHERE id_hash = ?').run(idHash);
      reply.clearCookie(SESSION_COOKIE, { path: '/' });
      return unauthorized(reply);
    }
    const user = getUserById(s.user_id);
    if (!user) return unauthorized(reply);
    // durée glissante : prolonge si plus d'une heure s'est écoulée
    if (s.expires_at - now < SESSION_TTL_MS - 3600_000) {
      db.prepare('UPDATE sessions SET expires_at = ? WHERE id_hash = ?').run(now + SESSION_TTL_MS, idHash);
      reply.setCookie(SESSION_COOKIE, token, cookieOpts(req, SESSION_TTL_MS));
    }
    req.user = user;
    req.sessionHash = idHash;
  });
}

// Pas d'encapsulation : décorateurs et hooks visibles par les routes sœurs (équivalent fastify-plugin).
(sessionPluginImpl as unknown as Record<symbol, boolean>)[Symbol.for('skip-override')] = true;
export const sessionPlugin = sessionPluginImpl;
