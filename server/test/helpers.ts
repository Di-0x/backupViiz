import type { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { randomUUID } from 'node:crypto';
import type { StrategyDoc } from '@backupviiz/shared';

process.env.NODE_ENV = 'test';
process.env.DATABASE_PATH = ':memory:';

/**
 * Faux plugin d'auth : l'en-tête `x-test-user` (nom d'utilisateur) authentifie la requête
 * (l'utilisateur est créé à la volée). Sans en-tête -> 401. Permet de tester les routes
 * métier indépendamment de l'implémentation réelle (sessions/cookies).
 */
export const fakeAuth: FastifyPluginAsync = async (app) => {
  const { db } = await import('../src/db');
  app.decorateRequest('user', undefined);
  app.decorate('requireAuth', async (req, reply) => {
    const name = req.headers['x-test-user'];
    if (typeof name !== 'string' || !name) {
      return reply.code(401).send({ error: { code: 'unauthorized', message: 'Authentification requise' } });
    }
    let row = db.prepare('SELECT id FROM users WHERE username = ?').get(name) as { id: string } | undefined;
    if (!row) {
      row = { id: randomUUID() };
      db.prepare('INSERT INTO users (id, username, webauthn_user_id, created_at) VALUES (?, ?, ?, ?)')
        .run(row.id, name, randomUUID(), new Date().toISOString());
    }
    req.user = { id: row.id, username: name, hasPassword: false, passkeyCount: 0 };
  });
};
(fakeAuth as unknown as Record<symbol, boolean>)[Symbol.for('skip-override')] = true; // pas d'encapsulation

export async function createTestApp(opts: { realAuth?: boolean } = {}): Promise<FastifyInstance> {
  const { buildApp } = await import('../src/app');
  const app = await buildApp(opts.realAuth ? {} : { authPlugin: fakeAuth });
  await app.ready();
  return app;
}

export const asUser = (name: string) => ({ 'x-test-user': name });

/** Doc 3-2-1 conforme : source (ssd) -> nas -> cloud offsite. */
export function compliantDoc(): StrategyDoc {
  return {
    nodes: [
      { id: 's1', kind: 'source', label: 'PC', mediaType: 'ssd', location: 'onsite', position: { x: 0, y: 0 } },
      { id: 'n1', kind: 'storage', label: 'NAS', mediaType: 'nas', location: 'onsite', position: { x: 260, y: 0 } },
      { id: 'c1', kind: 'storage', label: 'Cloud', mediaType: 'cloud', location: 'offsite', position: { x: 520, y: 0 } },
    ],
    edges: [
      { id: 'e1', from: 's1', to: 'n1', schedule: 'Quotidien' },
      { id: 'e2', from: 'n1', to: 'c1', schedule: 'Quotidien' },
    ],
  };
}
