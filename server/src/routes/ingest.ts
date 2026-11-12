import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { StrategyDoc } from '@backupviiz/shared';
import { db } from '../db';
import { sha256 } from '../auth/session';
import { evaluateWithStatuses, loadStatuses } from '../lib/statuses';
import { TOKEN_PREFIX } from './tokens';

const INGEST_BODY_LIMIT = 2 * 1024 * 1024; // 2 MB (sortie de `restic snapshots --json`)

const bodySchema = z.object({
  tool: z.literal('restic').optional(),
  status: z.enum(['ok', 'failed']),
  // On ne retient que `time` ; le reste de chaque snapshot est ignoré.
  snapshots: z.array(z.object({ time: z.string().max(64) }).passthrough()).optional(),
  message: z.string().max(2000).optional(),
  sizeBytes: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).optional(),
});

const err = (status: number, code: string, message: string) => Object.assign(new Error(message), { statusCode: status, code });

function bearer(req: FastifyRequest): string | null {
  const h = req.headers.authorization;
  if (typeof h !== 'string') return null;
  const m = /^Bearer\s+(\S+)$/i.exec(h);
  return m ? m[1]! : null;
}

export default async function ingestRoutes(app: FastifyInstance): Promise<void> {
  // Pas de cookie/session : le jeton Bearer authentifie. (Le hook CSRF ne touche que les requêtes avec Origin.)
  const rateLimit = {
    max: 60, timeWindow: '1 minute',
    keyGenerator: (req: FastifyRequest) => { const t = bearer(req); return t ? `tok:${sha256(t)}` : `ip:${req.ip}`; },
  };

  const authenticate = (req: FastifyRequest, reply: FastifyReply): { userId: string; tokenId: string } | null => {
    const token = bearer(req);
    const row = token && token.startsWith(TOKEN_PREFIX)
      ? (db.prepare('SELECT id, user_id FROM api_tokens WHERE token_hash = ?').get(sha256(token)) as unknown as { id: string; user_id: string } | undefined)
      : undefined;
    if (!row) {
      void reply.code(401).header('WWW-Authenticate', 'Bearer').send({ error: { code: 'unauthorized', message: 'Jeton API invalide ou manquant' } });
      return null;
    }
    return { userId: row.user_id, tokenId: row.id };
  };

  function ingest(req: FastifyRequest, reply: FastifyReply, resolveNode: (doc: StrategyDoc) => string) {
    const auth = authenticate(req, reply);
    if (!auth) return reply;
    const { strategyId } = req.params as { strategyId: string };
    const body = bodySchema.parse(req.body ?? {});
    const strat = db.prepare('SELECT id, doc FROM strategies WHERE id = ? AND user_id = ?').get(strategyId, auth.userId) as unknown as { id: string; doc: string } | undefined;
    if (!strat) throw err(404, 'not_found', 'Stratégie introuvable');
    const doc = JSON.parse(strat.doc) as StrategyDoc;
    const nodeId = resolveNode(doc);

    const now = new Date();
    db.prepare('UPDATE api_tokens SET last_used_at = ? WHERE id = ?').run(now.toISOString(), auth.tokenId);

    let latest: string | null = null;
    for (const s of body.snapshots ?? []) {
      const t = Date.parse(s.time);
      if (Number.isFinite(t) && (latest === null || t > Date.parse(latest))) latest = new Date(t).toISOString();
    }
    const prev = db.prepare('SELECT last_success_at, snapshot_count, size_bytes FROM node_status WHERE strategy_id = ? AND node_id = ?')
      .get(strat.id, nodeId) as unknown as { last_success_at: string | null; snapshot_count: number | null; size_bytes: number | null } | undefined;
    const lastSuccessAt = body.status === 'ok' && latest ? latest : (prev?.last_success_at ?? null);
    const snapshotCount = body.snapshots ? body.snapshots.length : (prev?.snapshot_count ?? null);
    const sizeBytes = body.sizeBytes ?? prev?.size_bytes ?? null;
    db.prepare(`INSERT INTO node_status (strategy_id, node_id, tool, last_success_at, last_status, snapshot_count, size_bytes, message, reported_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(strategy_id, node_id) DO UPDATE SET tool = excluded.tool, last_success_at = excluded.last_success_at,
        last_status = excluded.last_status, snapshot_count = excluded.snapshot_count, size_bytes = excluded.size_bytes,
        message = excluded.message, reported_at = excluded.reported_at`)
      .run(strat.id, nodeId, body.tool ?? 'restic', lastSuccessAt, body.status, snapshotCount, sizeBytes, body.message ?? null, now.toISOString());

    const evaluationStatus = evaluateWithStatuses(doc, loadStatuses(strat.id), now).status;
    return reply.send({ ok: true, evaluationStatus });
  }

  app.post('/:strategyId/by-hostname/:hostname', { bodyLimit: INGEST_BODY_LIMIT, config: { rateLimit } }, async (req, reply) =>
    ingest(req, reply, (doc) => {
      const { hostname } = req.params as { hostname: string };
      const h = hostname.trim().toLowerCase();
      const matches = doc.nodes.filter((n) => n.hostname?.trim().toLowerCase() === h);
      if (matches.length === 0) throw err(404, 'not_found', 'Aucun noeud avec ce hostname');
      if (matches.length > 1) throw err(409, 'conflict', 'Hostname ambigu : plusieurs noeuds correspondent, utilisez l\'id du noeud');
      return matches[0]!.id;
    }));

  app.post('/:strategyId/:nodeId', { bodyLimit: INGEST_BODY_LIMIT, config: { rateLimit } }, async (req, reply) =>
    ingest(req, reply, (doc) => {
      const { nodeId } = req.params as { nodeId: string };
      if (!doc.nodes.some((n) => n.id === nodeId)) throw err(404, 'not_found', 'Noeud introuvable');
      return nodeId;
    }));
}
