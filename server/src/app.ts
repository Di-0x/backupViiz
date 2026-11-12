import Fastify, { type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { sessionPlugin } from './auth/session';
import authRoutes from './routes/auth';
import passkeyRoutes from './routes/passkey';
import strategyRoutes from './routes/strategies';

export async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({ logger: process.env.NODE_ENV !== 'test', trustProxy: process.env.TRUST_PROXY === 'true' });

  await app.register(helmet, { contentSecurityPolicy: { directives: { defaultSrc: ["'self'"], styleSrc: ["'self'", "'unsafe-inline'"], imgSrc: ["'self'", 'data:'] } } });
  await app.register(cookie);
  await app.register(rateLimit, { global: false });
  await app.register(sessionPlugin); // décore app.requireAuth + request.user

  app.get('/api/health', async () => ({ status: 'ok' }));
  await app.register(authRoutes, { prefix: '/api/auth' });
  await app.register(passkeyRoutes, { prefix: '/api/auth/passkey' });
  await app.register(strategyRoutes, { prefix: '/api/strategies' });

  // SPA statique (build web) — WEB_DIST par défaut ../web/dist relatif au cwd ou /app/public en Docker
  const webDist = resolve(process.env.WEB_DIST ?? 'public');
  if (existsSync(webDist)) {
    await app.register(fastifyStatic, { root: webDist, wildcard: false, maxAge: '1y', immutable: true,
      setHeaders: (res, p) => { if (p.endsWith('index.html') || p.endsWith('sw.js')) res.setHeader('Cache-Control', 'no-cache'); } });
    app.setNotFoundHandler((req, reply) => {
      if (req.url.startsWith('/api/')) return reply.code(404).send({ error: { code: 'not_found', message: 'Route introuvable' } });
      return reply.header('Cache-Control', 'no-cache').sendFile('index.html');
    });
  }
  return app;
}
