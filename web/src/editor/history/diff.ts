import type { StrategyDoc } from '@backupviiz/shared';

export interface DocDiff {
  nodesAdded: number;
  nodesRemoved: number;
  nodesChanged: number;
  edgesAdded: number;
  edgesRemoved: number;
}

/** Différence entre l'état actuel (`from`) et la version (`to`) : ce que la restauration ajouterait/retirerait. */
export function diffDocs(from: StrategyDoc, to: StrategyDoc): DocDiff {
  const fn = new Map(from.nodes.map((n) => [n.id, n]));
  const tn = new Map(to.nodes.map((n) => [n.id, n]));
  const fe = new Set(from.edges.map((e) => e.id));
  const te = new Set(to.edges.map((e) => e.id));
  let nodesAdded = 0, nodesRemoved = 0, nodesChanged = 0, edgesAdded = 0, edgesRemoved = 0;
  for (const [id, n] of tn) {
    const o = fn.get(id);
    if (!o) nodesAdded++;
    else if (JSON.stringify({ ...o, position: 0 }) !== JSON.stringify({ ...n, position: 0 })) nodesChanged++;
  }
  for (const id of fn.keys()) if (!tn.has(id)) nodesRemoved++;
  for (const id of te) if (!fe.has(id)) edgesAdded++;
  for (const id of fe) if (!te.has(id)) edgesRemoved++;
  return { nodesAdded, nodesRemoved, nodesChanged, edgesAdded, edgesRemoved };
}

const plural = (n: number, one: string, many: string) => `${n} ${n > 1 ? many : one}`;

export function describeDiff(d: DocDiff): string {
  const parts: string[] = [];
  if (d.nodesAdded) parts.push(`+${plural(d.nodesAdded, 'nœud', 'nœuds')}`);
  if (d.nodesRemoved) parts.push(`−${plural(d.nodesRemoved, 'nœud', 'nœuds')}`);
  if (d.nodesChanged) parts.push(`~${plural(d.nodesChanged, 'nœud modifié', 'nœuds modifiés')}`);
  if (d.edgesAdded) parts.push(`+${plural(d.edgesAdded, 'lien', 'liens')}`);
  if (d.edgesRemoved) parts.push(`−${plural(d.edgesRemoved, 'lien', 'liens')}`);
  return parts.length ? parts.join(', ') : 'Identique à l’état actuel';
}

export function relativeTime(iso: string, now = new Date()): string {
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return '';
  const s = Math.round((now.getTime() - t) / 1000);
  if (s < 60) return 'à l’instant';
  const m = Math.round(s / 60);
  if (m < 60) return `il y a ${m} min`;
  const h = Math.round(m / 60);
  if (h < 24) return `il y a ${h} h`;
  const d = Math.round(h / 24);
  if (d < 30) return `il y a ${d} j`;
  const mo = Math.round(d / 30);
  return mo < 12 ? `il y a ${mo} mois` : `il y a ${Math.round(mo / 12)} an(s)`;
}

export function absoluteTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString('fr-FR', { dateStyle: 'medium', timeStyle: 'short' });
}
