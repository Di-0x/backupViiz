import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import {
  createStrategySchema, evaluate, strategyDocSchema, updateStrategySchema,
  type Strategy, type StrategyDoc, type StrategySummary,
} from '@backupviiz/shared';
import { db } from '../db';

interface Row { id: string; user_id: string; name: string; description: string; doc: string; created_at: string; updated_at: string }

const EMPTY_DOC: StrategyDoc = { nodes: [], edges: [] };

const importSchema = z.object({
  name: z.string().trim().min(1).max(100).optional(),
  description: z.string().max(500).optional(),
  doc: strategyDocSchema,
});

function httpError(status: number, code: string, message: string): Error {
  return Object.assign(new Error(message), { statusCode: status, code });
}
const notFound = () => httpError(404, 'not_found', 'Stratégie introuvable');

/** Valide un body avec zod ; ZodError -> 400 via le gestionnaire d'erreurs global. */
function parse<T>(schema: z.ZodType<T, z.ZodTypeDef, unknown>, body: unknown): T {
  return schema.parse(body ?? {});
}

function toStrategy(r: Row): Strategy {
  const doc = JSON.parse(r.doc) as StrategyDoc;
  return {
    id: r.id, name: r.name, description: r.description,
    createdAt: r.created_at, updatedAt: r.updated_at,
    nodes: doc.nodes, edges: doc.edges, evaluation: evaluate(doc),
  };
}

function toSummary(r: Row): StrategySummary {
  const doc = JSON.parse(r.doc) as StrategyDoc;
  const ev = evaluate(doc);
  return {
    id: r.id, name: r.name, description: r.description, updatedAt: r.updated_at,
    nodeCount: doc.nodes.length, edgeCount: doc.edges.length, status: ev.status,
    errorCount: ev.alerts.filter((a) => a.severity === 'error').length,
    warningCount: ev.alerts.filter((a) => a.severity === 'warning').length,
  };
}

export default async function strategyRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', app.requireAuth);

  const uid = (req: FastifyRequest): string => {
    if (!req.user) throw httpError(401, 'unauthorized', 'Authentification requise');
    return req.user.id;
  };
  const selectOwned = db.prepare('SELECT * FROM strategies WHERE id = ? AND user_id = ?');
  const insert = db.prepare('INSERT INTO strategies (id, user_id, name, description, doc, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)');
  const getOwned = (req: FastifyRequest): Row => {
    const { id } = req.params as { id: string };
    const row = selectOwned.get(id, uid(req)) as Row | undefined;
    if (!row) throw notFound();
    return row;
  };
  const create = (userId: string, name: string, description: string, doc: StrategyDoc): Row => {
    const now = new Date().toISOString();
    const row: Row = { id: randomUUID(), user_id: userId, name, description, doc: JSON.stringify(doc), created_at: now, updated_at: now };
    insert.run(row.id, userId, name, description, row.doc, now, now);
    return row;
  };

  app.get('/', async (req) => {
    const rows = db.prepare('SELECT * FROM strategies WHERE user_id = ? ORDER BY updated_at DESC, rowid DESC').all(uid(req)) as unknown as Row[];
    return rows.map(toSummary);
  });

  app.post('/', async (req, reply) => {
    const body = parse(createStrategySchema, req.body) as { name: string; description?: string; doc?: StrategyDoc };
    const row = create(uid(req), body.name, body.description ?? '', body.doc ?? EMPTY_DOC);
    return reply.code(201).send(toStrategy(row));
  });

  // /import déclaré avant /:id n'est pas nécessaire (méthodes/segments différents) mais reste explicite.
  app.post('/import', async (req, reply) => {
    const body = parse(importSchema, req.body);
    const row = create(uid(req), body.name ?? 'Stratégie importée', body.description ?? '', body.doc);
    return reply.code(201).send(toStrategy(row));
  });

  app.get('/:id', async (req) => toStrategy(getOwned(req)));

  app.put('/:id', async (req) => {
    const cur = getOwned(req);
    const body = parse(updateStrategySchema, req.body) as { name?: string; description?: string; doc?: StrategyDoc };
    const name = body.name ?? cur.name;
    const description = body.description ?? cur.description;
    const doc = body.doc ? JSON.stringify(body.doc) : cur.doc;
    const updatedAt = new Date().toISOString();
    db.prepare('UPDATE strategies SET name = ?, description = ?, doc = ?, updated_at = ? WHERE id = ? AND user_id = ?')
      .run(name, description, doc, updatedAt, cur.id, cur.user_id);
    return toStrategy({ ...cur, name, description, doc, updated_at: updatedAt });
  });

  app.delete('/:id', async (req, reply) => {
    const cur = getOwned(req);
    db.prepare('DELETE FROM strategies WHERE id = ? AND user_id = ?').run(cur.id, cur.user_id);
    return reply.code(204).send();
  });

  app.post('/:id/duplicate', async (req, reply) => {
    const cur = getOwned(req);
    const row = create(cur.user_id, `Copie de ${cur.name}`.slice(0, 100), cur.description, JSON.parse(cur.doc) as StrategyDoc);
    return reply.code(201).send(toStrategy(row));
  });

  app.get('/:id/export', async (req, reply: FastifyReply) => {
    const cur = getOwned(req);
    const file = (cur.name.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9._-]+/g, '_').replace(/^_+|_+$/g, '') || 'strategie') + '.backupviiz.json';
    return reply
      .header('Content-Disposition', `attachment; filename="${file}"`)
      .type('application/json; charset=utf-8')
      .send({ version: 1, name: cur.name, description: cur.description, doc: JSON.parse(cur.doc) });
  });
}
