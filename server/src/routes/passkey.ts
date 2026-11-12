import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { randomBytes, randomUUID } from 'node:crypto';
import { z } from 'zod';
import {
  generateAuthenticationOptions, generateRegistrationOptions,
  verifyAuthenticationResponse, verifyRegistrationResponse,
} from '@simplewebauthn/server';
import type { AuthenticationResponseJSON, AuthenticatorTransportFuture, RegistrationResponseJSON } from '@simplewebauthn/server';
import type { PasskeyInfo } from '@backupviiz/shared';
import { db } from '../db';
import { cookieOpts, createSession, getUserById, sendError, purgeExpired } from '../auth/session';
import { registrationOpen, usernameSchema, zodFields } from './auth';

const CHALLENGE_COOKIE = 'bv_wa';
const CHALLENGE_TTL_MS = 5 * 60 * 1000;
const RP_NAME = 'BackupViiz';
const LIMIT = { rateLimit: { max: 20, timeWindow: '1 minute' } };

type Purpose = 'register' | 'login' | 'signup';

function rpInfo(req: FastifyRequest): { rpID: string; origin: string } {
  // Origin (déjà validée = host par le hook CSRF) sinon protocole + host ; surchargeable par env.
  const origin = process.env.WEBAUTHN_ORIGIN || req.headers.origin || `${req.protocol}://${req.host}`;
  let rpID = process.env.WEBAUTHN_RP_ID;
  if (!rpID) {
    try { rpID = new URL(origin).hostname; } catch { rpID = req.hostname; }
  }
  return { rpID, origin };
}

function saveChallenge(req: FastifyRequest, reply: FastifyReply, challenge: string, purpose: Purpose, userId: string | null): void {
  if (Math.random() < 0.1) purgeExpired();
  const id = randomBytes(24).toString('base64url');
  db.prepare('INSERT INTO webauthn_challenges (id, challenge, user_id, purpose, expires_at) VALUES (?, ?, ?, ?, ?)')
    .run(id, challenge, userId, purpose, Date.now() + CHALLENGE_TTL_MS);
  reply.setCookie(CHALLENGE_COOKIE, id, cookieOpts(req, CHALLENGE_TTL_MS));
}

/** Usage unique : la ligne est supprimée dès la lecture. */
function consumeChallenge(req: FastifyRequest, reply: FastifyReply, purpose: Purpose): { challenge: string; userId: string | null } | null {
  const id = req.cookies?.[CHALLENGE_COOKIE];
  reply.clearCookie(CHALLENGE_COOKIE, { path: '/' });
  if (!id) return null;
  const row = db.prepare('SELECT challenge, user_id, purpose, expires_at FROM webauthn_challenges WHERE id = ?').get(id) as unknown as
    { challenge: string; user_id: string | null; purpose: string; expires_at: number } | undefined;
  if (!row) return null;
  db.prepare('DELETE FROM webauthn_challenges WHERE id = ?').run(id);
  if (row.expires_at < Date.now() || row.purpose !== purpose) return null;
  return { challenge: row.challenge, userId: row.user_id };
}

const badChallenge = (reply: FastifyReply) => sendError(reply, 400, 'challenge_invalid', 'Défi WebAuthn expiré ou invalide, réessayez');

interface PasskeyRow { id: string; user_id: string; public_key: Uint8Array; counter: number; transports: string | null; name: string; created_at: string; last_used_at: string | null }

const toInfo = (r: Pick<PasskeyRow, 'id' | 'name' | 'created_at' | 'last_used_at'>): PasskeyInfo =>
  ({ id: r.id, name: r.name, createdAt: r.created_at, lastUsedAt: r.last_used_at });

function parseTransports(s: string | null): AuthenticatorTransportFuture[] | undefined {
  if (!s) return undefined;
  try { const v = JSON.parse(s); return Array.isArray(v) ? v : undefined; } catch { return undefined; }
}

const responseSchema = z.object({ id: z.string().min(1).max(1024), response: z.object({}).passthrough() }).passthrough();
const registerVerifySchema = z.object({ response: responseSchema, name: z.string().trim().min(1).max(50).optional() });
const loginOptionsSchema = z.object({ username: z.string().max(64).optional() }).optional();
const loginVerifySchema = z.object({ response: responseSchema });
const signupOptionsSchema = z.object({ username: usernameSchema });
const nameSchema = z.object({ name: z.string().trim().min(1, 'Nom requis').max(50, '50 caractères maximum') });

function insertPasskey(userId: string, cred: { id: string; publicKey: Uint8Array; counter: number; transports?: string[] }, name: string): PasskeyInfo {
  const createdAt = new Date().toISOString();
  db.prepare('INSERT INTO passkeys (id, user_id, public_key, counter, transports, name, created_at, last_used_at) VALUES (?, ?, ?, ?, ?, ?, ?, NULL)')
    .run(cred.id, userId, cred.publicKey, cred.counter, cred.transports ? JSON.stringify(cred.transports) : null, name, createdAt);
  return { id: cred.id, name, createdAt, lastUsedAt: null };
}

const authenticatorSelection = { residentKey: 'preferred', userVerification: 'preferred' } as const;

export default async function passkeyRoutes(app: FastifyInstance): Promise<void> {
  // ---- Inscription d'une passkey pour le compte connecté
  app.post('/register/options', { preHandler: app.requireAuth, config: LIMIT }, async (req, reply) => {
    const user = req.user!;
    const { rpID } = rpInfo(req);
    const u = db.prepare('SELECT webauthn_user_id FROM users WHERE id = ?').get(user.id) as unknown as { webauthn_user_id: string };
    const existing = db.prepare('SELECT id, transports FROM passkeys WHERE user_id = ?').all(user.id) as unknown as PasskeyRow[];
    const options = await generateRegistrationOptions({
      rpName: RP_NAME, rpID, userName: user.username,
      userID: new Uint8Array(Buffer.from(u.webauthn_user_id, 'base64url')),
      attestationType: 'none',
      excludeCredentials: existing.map((p) => ({ id: p.id, transports: parseTransports(p.transports) })),
      authenticatorSelection,
    });
    saveChallenge(req, reply, options.challenge, 'register', user.id);
    return options;
  });

  app.post('/register/verify', { preHandler: app.requireAuth, config: LIMIT }, async (req, reply) => {
    const parsed = registerVerifySchema.safeParse(req.body);
    if (!parsed.success) return sendError(reply, 400, 'validation', 'Données invalides', zodFields(parsed.error));
    const user = req.user!;
    const ch = consumeChallenge(req, reply, 'register');
    if (!ch || ch.userId !== user.id) return badChallenge(reply);
    const { rpID, origin } = rpInfo(req);
    let result;
    try {
      result = await verifyRegistrationResponse({
        response: parsed.data.response as unknown as RegistrationResponseJSON,
        expectedChallenge: ch.challenge, expectedOrigin: origin, expectedRPID: rpID,
      });
    } catch {
      return sendError(reply, 400, 'verification_failed', 'Vérification de la passkey échouée');
    }
    if (!result.verified) return sendError(reply, 400, 'verification_failed', 'Vérification de la passkey échouée');
    const cred = result.registrationInfo.credential;
    if (db.prepare('SELECT 1 FROM passkeys WHERE id = ?').get(cred.id)) {
      return sendError(reply, 409, 'passkey_exists', 'Cette passkey est déjà enregistrée');
    }
    const n = db.prepare('SELECT COUNT(*) AS c FROM passkeys WHERE user_id = ?').get(user.id) as unknown as { c: number };
    const name = parsed.data.name ?? `Passkey ${Number(n.c) + 1}`;
    return reply.code(201).send(insertPasskey(user.id, cred, name));
  });

  // ---- Connexion par passkey
  app.post('/login/options', { config: LIMIT }, async (req, reply) => {
    const parsed = loginOptionsSchema.safeParse(req.body ?? undefined);
    if (!parsed.success) return sendError(reply, 400, 'validation', 'Données invalides', zodFields(parsed.error));
    const { rpID } = rpInfo(req);
    let allowCredentials: { id: string; transports?: AuthenticatorTransportFuture[] }[] | undefined;
    const username = parsed.data?.username;
    if (username) {
      const rows = db.prepare('SELECT p.id, p.transports FROM passkeys p JOIN users u ON u.id = p.user_id WHERE u.username = ?').all(username) as unknown as PasskeyRow[];
      // utilisateur inconnu / sans passkey : options génériques (pas d'énumération)
      if (rows.length) allowCredentials = rows.map((p) => ({ id: p.id, transports: parseTransports(p.transports) }));
    }
    const options = await generateAuthenticationOptions({ rpID, userVerification: 'preferred', allowCredentials });
    saveChallenge(req, reply, options.challenge, 'login', null);
    return options;
  });

  app.post('/login/verify', { config: LIMIT }, async (req, reply) => {
    const parsed = loginVerifySchema.safeParse(req.body);
    if (!parsed.success) return sendError(reply, 400, 'validation', 'Données invalides', zodFields(parsed.error));
    const ch = consumeChallenge(req, reply, 'login');
    if (!ch) return badChallenge(reply);
    const response = parsed.data.response as unknown as AuthenticationResponseJSON;
    const pk = db.prepare('SELECT * FROM passkeys WHERE id = ?').get(response.id) as unknown as PasskeyRow | undefined;
    const fail = () => sendError(reply, 401, 'invalid_credentials', 'Passkey non reconnue ou invalide');
    if (!pk) return fail();
    const { rpID, origin } = rpInfo(req);
    let result;
    try {
      result = await verifyAuthenticationResponse({
        response, expectedChallenge: ch.challenge, expectedOrigin: origin, expectedRPID: rpID,
        credential: { id: pk.id, publicKey: new Uint8Array(pk.public_key), counter: Number(pk.counter), transports: parseTransports(pk.transports) },
      });
    } catch {
      return fail();
    }
    if (!result.verified) return fail();
    db.prepare('UPDATE passkeys SET counter = ?, last_used_at = ? WHERE id = ?')
      .run(result.authenticationInfo.newCounter, new Date().toISOString(), pk.id);
    const user = getUserById(pk.user_id);
    if (!user) return fail();
    createSession(req, reply, user.id);
    return user;
  });

  // ---- Inscription passkey-only
  app.post('/signup/options', { config: LIMIT }, async (req, reply) => {
    const parsed = signupOptionsSchema.safeParse(req.body);
    if (!parsed.success) return sendError(reply, 400, 'validation', 'Données invalides', zodFields(parsed.error));
    if (!registrationOpen()) return sendError(reply, 403, 'registration_closed', "L'inscription est fermée");
    const { username } = parsed.data;
    if (db.prepare('SELECT 1 FROM users WHERE username = ?').get(username)) {
      return sendError(reply, 409, 'username_taken', "Ce nom d'utilisateur est déjà pris", { username: 'Déjà pris' });
    }
    const { rpID } = rpInfo(req);
    const webauthnUserId = randomBytes(32).toString('base64url');
    const options = await generateRegistrationOptions({
      rpName: RP_NAME, rpID, userName: username,
      userID: new Uint8Array(Buffer.from(webauthnUserId, 'base64url')),
      attestationType: 'none', authenticatorSelection,
    });
    // le défi porte le futur compte (JSON dans user_id)
    saveChallenge(req, reply, options.challenge, 'signup', JSON.stringify({ username, webauthnUserId }));
    return options;
  });

  app.post('/signup/verify', { config: LIMIT }, async (req, reply) => {
    const parsed = loginVerifySchema.safeParse(req.body);
    if (!parsed.success) return sendError(reply, 400, 'validation', 'Données invalides', zodFields(parsed.error));
    const ch = consumeChallenge(req, reply, 'signup');
    if (!ch || !ch.userId) return badChallenge(reply);
    let pending: { username: string; webauthnUserId: string };
    try { pending = JSON.parse(ch.userId); } catch { return badChallenge(reply); }
    if (!registrationOpen()) return sendError(reply, 403, 'registration_closed', "L'inscription est fermée");
    const { rpID, origin } = rpInfo(req);
    let result;
    try {
      result = await verifyRegistrationResponse({
        response: parsed.data.response as unknown as RegistrationResponseJSON,
        expectedChallenge: ch.challenge, expectedOrigin: origin, expectedRPID: rpID,
      });
    } catch {
      return sendError(reply, 400, 'verification_failed', 'Vérification de la passkey échouée');
    }
    if (!result.verified) return sendError(reply, 400, 'verification_failed', 'Vérification de la passkey échouée');
    const cred = result.registrationInfo.credential;
    const id = randomUUID();
    try {
      db.prepare('INSERT INTO users (id, username, password_hash, webauthn_user_id, created_at) VALUES (?, ?, NULL, ?, ?)')
        .run(id, pending.username, pending.webauthnUserId, new Date().toISOString());
    } catch {
      return sendError(reply, 409, 'username_taken', "Ce nom d'utilisateur est déjà pris", { username: 'Déjà pris' });
    }
    try {
      insertPasskey(id, cred, 'Passkey 1');
    } catch {
      db.prepare('DELETE FROM users WHERE id = ?').run(id);
      return sendError(reply, 409, 'passkey_exists', 'Cette passkey est déjà enregistrée');
    }
    createSession(req, reply, id);
    return reply.code(201).send(getUserById(id));
  });

  // ---- Gestion
  app.get('/', { preHandler: app.requireAuth }, async (req) => {
    const rows = db.prepare('SELECT id, name, created_at, last_used_at FROM passkeys WHERE user_id = ? ORDER BY created_at, id').all(req.user!.id) as unknown as PasskeyRow[];
    return rows.map(toInfo);
  });

  app.patch<{ Params: { id: string } }>('/:id', { preHandler: app.requireAuth }, async (req, reply) => {
    const parsed = nameSchema.safeParse(req.body);
    if (!parsed.success) return sendError(reply, 400, 'validation', 'Données invalides', zodFields(parsed.error));
    const r = db.prepare('UPDATE passkeys SET name = ? WHERE id = ? AND user_id = ?').run(parsed.data.name, req.params.id, req.user!.id);
    if (!Number(r.changes)) return sendError(reply, 404, 'not_found', 'Passkey introuvable');
    return toInfo(db.prepare('SELECT id, name, created_at, last_used_at FROM passkeys WHERE id = ?').get(req.params.id) as unknown as PasskeyRow);
  });

  app.delete<{ Params: { id: string } }>('/:id', { preHandler: app.requireAuth }, async (req, reply) => {
    const user = req.user!;
    const own = db.prepare('SELECT 1 FROM passkeys WHERE id = ? AND user_id = ?').get(req.params.id, user.id);
    if (!own) return sendError(reply, 404, 'not_found', 'Passkey introuvable');
    if (!user.hasPassword && user.passkeyCount <= 1) {
      return sendError(reply, 409, 'last_credential', 'Impossible de supprimer le dernier moyen de connexion : définissez d\'abord un mot de passe');
    }
    db.prepare('DELETE FROM passkeys WHERE id = ? AND user_id = ?').run(req.params.id, user.id);
    return reply.code(204).send();
  });
}
