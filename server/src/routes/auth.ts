import type { FastifyInstance } from 'fastify';
import { randomUUID, randomBytes } from 'node:crypto';
import { z } from 'zod';
import { db } from '../db';
import { hashPassword, verifyPassword, dummyHash } from '../auth/password';
import { createSession, destroySession, sendError, toUser } from '../auth/session';

export const usernameSchema = z.string().regex(/^[a-zA-Z0-9._-]{3,32}$/, '3 à 32 caractères : lettres, chiffres, . _ -');
const passwordSchema = z.string().min(10, 'Au moins 10 caractères').max(256, '256 caractères maximum');

export function registrationOpen(): boolean {
  if (process.env.ALLOW_REGISTRATION === 'true') return true;
  const r = db.prepare('SELECT COUNT(*) AS c FROM users').get() as unknown as { c: number };
  return Number(r.c) === 0;
}

export function zodFields(err: z.ZodError): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const i of err.issues) fields[i.path.join('.') || '_'] ??= i.message;
  return fields;
}

const registerSchema = z.object({ username: usernameSchema, password: passwordSchema });
const loginSchema = z.object({ username: z.string().min(1).max(64), password: z.string().min(1).max(256) });
const passwordChangeSchema = z.object({ currentPassword: z.string().max(256).optional(), newPassword: passwordSchema });

const LOGIN_LIMIT = { rateLimit: { max: 10, timeWindow: '1 minute' } };

export default async function authRoutes(app: FastifyInstance): Promise<void> {
  app.get('/config', async () => ({ registrationOpen: registrationOpen() }));

  app.post('/register', { config: LOGIN_LIMIT }, async (req, reply) => {
    const parsed = registerSchema.safeParse(req.body);
    if (!parsed.success) return sendError(reply, 400, 'validation', 'Données invalides', zodFields(parsed.error));
    if (!registrationOpen()) return sendError(reply, 403, 'registration_closed', "L'inscription est fermée");
    const { username, password } = parsed.data;
    if (db.prepare('SELECT 1 FROM users WHERE username = ?').get(username)) {
      return sendError(reply, 409, 'username_taken', "Ce nom d'utilisateur est déjà pris", { username: 'Déjà pris' });
    }
    const id = randomUUID();
    const hash = await hashPassword(password);
    try {
      db.prepare('INSERT INTO users (id, username, password_hash, webauthn_user_id, created_at) VALUES (?, ?, ?, ?, ?)')
        .run(id, username, hash, randomBytes(32).toString('base64url'), new Date().toISOString());
    } catch {
      return sendError(reply, 409, 'username_taken', "Ce nom d'utilisateur est déjà pris", { username: 'Déjà pris' });
    }
    createSession(req, reply, id);
    return reply.code(201).send(toUser({ id, username, password_hash: hash }));
  });

  app.post('/login', { config: LOGIN_LIMIT }, async (req, reply) => {
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) return sendError(reply, 400, 'validation', 'Données invalides', zodFields(parsed.error));
    const { username, password } = parsed.data;
    const row = db.prepare('SELECT id, username, password_hash FROM users WHERE username = ?').get(username) as unknown as
      { id: string; username: string; password_hash: string | null } | undefined;
    // toujours un scrypt, même si l'utilisateur est inconnu ou sans mot de passe
    const ok = await verifyPassword(password, row?.password_hash ?? (await dummyHash()));
    if (!row || !row.password_hash || !ok) return sendError(reply, 401, 'invalid_credentials', 'Identifiants incorrects');
    createSession(req, reply, row.id);
    return toUser(row);
  });

  app.post('/logout', async (req, reply) => {
    destroySession(req, reply);
    return reply.code(204).send();
  });

  app.get('/me', { preHandler: app.requireAuth }, async (req) => req.user!);

  app.post('/password', { preHandler: app.requireAuth, config: LOGIN_LIMIT }, async (req, reply) => {
    const parsed = passwordChangeSchema.safeParse(req.body);
    if (!parsed.success) return sendError(reply, 400, 'validation', 'Données invalides', zodFields(parsed.error));
    const user = req.user!;
    const row = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(user.id) as unknown as { password_hash: string | null };
    if (row.password_hash) {
      const cur = parsed.data.currentPassword;
      if (!cur || !(await verifyPassword(cur, row.password_hash))) {
        return sendError(reply, 403, 'invalid_password', 'Mot de passe actuel incorrect', { currentPassword: 'Incorrect' });
      }
    }
    const hash = await hashPassword(parsed.data.newPassword);
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hash, user.id);
    db.prepare('DELETE FROM sessions WHERE user_id = ? AND id_hash != ?').run(user.id, req.sessionHash!);
    return { ...user, hasPassword: true };
  });
}
