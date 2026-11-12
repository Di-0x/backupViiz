import { evaluate, type Evaluation, type NodeStatus, type StrategyDoc } from '@backupviiz/shared';
import { db } from '../db';

interface StatusRow {
  node_id: string; tool: string; last_success_at: string | null; last_status: string;
  snapshot_count: number | null; size_bytes: number | null; message: string | null; reported_at: string;
}

/** Statuts réels reportés pour une stratégie, indexés par id de noeud. */
export function loadStatuses(strategyId: string): Record<string, NodeStatus> {
  const rows = db.prepare('SELECT node_id, tool, last_success_at, last_status, snapshot_count, size_bytes, message, reported_at FROM node_status WHERE strategy_id = ?')
    .all(strategyId) as unknown as StatusRow[];
  const out: Record<string, NodeStatus> = {};
  for (const r of rows) {
    out[r.node_id] = {
      tool: r.tool, lastSuccessAt: r.last_success_at, lastStatus: r.last_status === 'failed' ? 'failed' : 'ok',
      ...(r.snapshot_count != null ? { snapshotCount: Number(r.snapshot_count) } : {}),
      ...(r.size_bytes != null ? { sizeBytes: Number(r.size_bytes) } : {}),
      ...(r.message != null ? { message: r.message } : {}),
      reportedAt: r.reported_at,
    };
  }
  return out;
}

type EvaluateFn = (doc: StrategyDoc, opts?: { statuses?: Record<string, NodeStatus>; now?: Date }) => Evaluation;

/** Évalue avec les statuts réels (le moteur partagé ignore l'option tant qu'il ne la supporte pas). */
export function evaluateWithStatuses(doc: StrategyDoc, statuses: Record<string, NodeStatus>, now = new Date()): Evaluation {
  return (evaluate as EvaluateFn)(doc, { statuses, now });
}
