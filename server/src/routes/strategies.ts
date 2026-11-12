import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import {
  createStrategySchema, strategyDocSchema, updateStrategySchema,
  type Strategy, type StrategyDoc, type StrategySummary, type StrategyVersionSummary,
} from '@backupviiz/shared';
import { db } from '../db';
import { evaluateWithStatuses, loadStatuses } from '../lib/statuses';

interface Row { id: string; user_id: string; name: string; description: string; doc: string; created_at: string; updated_at: string }

const VERSION_COALESCE_MS = 2 * 60_000;
const MAX_VERSIONS = 50;

interface VersionRow { id: string; strategy_id: string; user_id: string; name: string; description: string; doc: string; reason: string; created_at: string }

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
  const statuses = loadStatuses(r.id);
  return {
    id: r.id, name: r.name, description: r.description,
    createdAt: r.created_at, updatedAt: r.updated_at,
    nodes: doc.nodes, edges: doc.edges,
    evaluation: evaluateWithStatuses(doc, statuses), statuses,
  };
}

function toSummary(r: Row): StrategySummary {
  const doc = JSON.parse(r.doc) as StrategyDoc;
  const ev = evaluateWithStatuses(doc, loadStatuses(r.id));
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

  const insertVersion = db.prepare('INSERT INTO strategy_versions (id, strategy_id, user_id, name, description, doc, reason, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
  const purgeVersions = db.prepare(`DELETE FROM strategy_versions WHERE strategy_id = ? AND rowid NOT IN
    (SELECT rowid FROM strategy_versions WHERE strategy_id = ? ORDER BY created_at DESC, rowid DESC LIMIT ${MAX_VERSIONS})`);
  const snapshot = (cur: Row, reason: 'auto' | 'restore'): void => {
    insertVersion.run(randomUUID(), cur.id, cur.user_id, cur.name, cur.description, cur.doc, reason, new Date().toISOString());
    purgeVersions.run(cur.id, cur.id);
  };
  const lastVersionAt = db.prepare('SELECT created_at FROM strategy_versions WHERE strategy_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 1');

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
    if (doc !== cur.doc) {
      // Snapshot de l'état précédent, coalescé si le dernier a moins de 2 min.
      const last = lastVersionAt.get(cur.id) as { created_at: string } | undefined;
      if (!last || Date.now() - new Date(last.created_at).getTime() >= VERSION_COALESCE_MS) snapshot(cur, 'auto');
    }
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

  const toVersionSummary = (v: VersionRow): StrategyVersionSummary => {
    const d = JSON.parse(v.doc) as StrategyDoc;
    return { id: v.id, createdAt: v.created_at, name: v.name, nodeCount: d.nodes.length, edgeCount: d.edges.length, reason: v.reason as 'auto' | 'restore' };
  };
  const getVersion = (req: FastifyRequest): VersionRow => {
    const cur = getOwned(req);
    const { vid } = req.params as { vid: string };
    const v = db.prepare('SELECT * FROM strategy_versions WHERE id = ? AND strategy_id = ? AND user_id = ?').get(vid, cur.id, cur.user_id) as unknown as VersionRow | undefined;
    if (!v) throw httpError(404, 'not_found', 'Version introuvable');
    return v;
  };

  app.get('/:id/versions', async (req) => {
    const cur = getOwned(req);
    const rows = db.prepare('SELECT * FROM strategy_versions WHERE strategy_id = ? AND user_id = ? ORDER BY created_at DESC, rowid DESC').all(cur.id, cur.user_id) as unknown as VersionRow[];
    return rows.map(toVersionSummary);
  });

  app.get('/:id/versions/:vid', async (req) => {
    const v = getVersion(req);
    return { id: v.id, createdAt: v.created_at, name: v.name, description: v.description, doc: JSON.parse(v.doc) as StrategyDoc };
  });

  app.post('/:id/versions/:vid/restore', async (req) => {
    const v = getVersion(req);
    const cur = getOwned(req);
    snapshot(cur, 'restore');
    const updatedAt = new Date().toISOString();
    db.prepare('UPDATE strategies SET name = ?, description = ?, doc = ?, updated_at = ? WHERE id = ? AND user_id = ?')
      .run(v.name, v.description, v.doc, updatedAt, cur.id, cur.user_id);
    return toStrategy({ ...cur, name: v.name, description: v.description, doc: v.doc, updated_at: updatedAt });
  });
}
