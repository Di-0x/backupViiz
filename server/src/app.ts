import Fastify, { type FastifyInstance, type FastifyPluginAsync } from 'fastify';
import cookie from '@fastify/cookie';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { ZodError } from 'zod';
import type { ApiError } from '@backupviiz/shared';
import { sessionPlugin } from './auth/session';
import authRoutes from './routes/auth';
import passkeyRoutes from './routes/passkey';
import strategyRoutes from './routes/strategies';

export interface BuildAppOptions {
  /** Remplace le plugin d'auth (tests uniquement) : doit décorer `requireAuth` et `request.user`. */
  authPlugin?: FastifyPluginAsync;
}

const BODY_LIMIT = 1024 * 1024; // 1 MB

const STATUS_CODES: Record<number, string> = {
  400: 'bad_request', 401: 'unauthorized', 403: 'forbidden', 404: 'not_found', 405: 'method_not_allowed',
  409: 'conflict', 413: 'payload_too_large', 415: 'unsupported_media_type', 429: 'too_many_requests',
};

function apiError(code: string, message: string, fields?: Record<string, string>): ApiError {
  return { error: fields ? { code, message, fields } : { code, message } };
}

export async function buildApp(opts: BuildAppOptions = {}): Promise<FastifyInstance> {
  const app = Fastify({
    logger: process.env.NODE_ENV !== 'test',
    trustProxy: process.env.TRUST_PROXY === 'true',
    bodyLimit: BODY_LIMIT,
  });

  // Erreurs JSON uniformes { error: { code, message, fields? } }
  app.setErrorHandler((err: Error & { statusCode?: number; code?: string; validation?: unknown }, req, reply) => {
    if (err instanceof ZodError) {
      const fields: Record<string, string> = {};
      for (const i of err.issues) fields[i.path.join('.') || '_'] ??= i.message;
      return reply.code(400).send(apiError('validation_error', 'Données invalides', fields));
    }
    const status = err.statusCode && err.statusCode >= 400 ? err.statusCode : 500;
    if (status >= 500) {
      req.log.error({ err }, 'erreur interne');
      return reply.code(500).send(apiError('internal_error', 'Erreur interne du serveur'));
    }
    const code = err.code === 'FST_ERR_CTP_BODY_TOO_LARGE' ? 'payload_too_large' : (STATUS_CODES[status] ?? 'error');
    return reply.code(status).send(apiError(code, err.message || 'Requête invalide'));
  });

  await app.register(helmet, { contentSecurityPolicy: { directives: { defaultSrc: ["'self'"], styleSrc: ["'self'", "'unsafe-inline'"], imgSrc: ["'self'", 'data:'] } } });
  await app.register(cookie);
  await app.register(rateLimit, { global: false });
  await app.register(opts.authPlugin ?? sessionPlugin); // décore app.requireAuth + request.user

  app.get('/api/health', async () => ({ status: 'ok' }));
  await app.register(authRoutes, { prefix: '/api/auth' });
  await app.register(passkeyRoutes, { prefix: '/api/auth/passkey' });
  await app.register(strategyRoutes, { prefix: '/api/strategies' });

  // SPA statique (build web) — WEB_DIST par défaut ../web/dist relatif au cwd ou /app/public en Docker
  const webDist = resolve(process.env.WEB_DIST ?? 'public');
  const hasWeb = existsSync(webDist);
  if (hasWeb) {
    await app.register(fastifyStatic, { root: webDist, wildcard: false, maxAge: '1y', immutable: true,
      setHeaders: (res, p) => { if (p.endsWith('index.html') || p.endsWith('sw.js')) res.setHeader('Cache-Control', 'no-cache'); } });
  }
  app.setNotFoundHandler((req, reply) => {
    if (hasWeb && req.method === 'GET' && !req.url.startsWith('/api/')) {
      return reply.header('Cache-Control', 'no-cache').sendFile('index.html');
    }
    return reply.code(404).send(apiError('not_found', 'Route introuvable'));
  });
  return app;
}
