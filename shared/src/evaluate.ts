import type {
  Alert,
  BackupNode,
  ComplianceStatus,
  Evaluation,
  MediaType,
  Severity,
  SourceEvaluation,
  StrategyDoc,
} from './types';

const SEVERITY_ORDER: Record<Severity, number> = { error: 0, warning: 1, info: 2 };

function plural(n: number, one: string, many: string): string {
  return n > 1 ? many : one;
}

/**
 * Évalue une stratégie selon la règle 3-2-1. Fonction pure, déterministe, O(N+E).
 */
export function evaluate(doc: StrategyDoc): Evaluation {
  const nodes = doc.nodes;
  const edges = doc.edges;
  const byId = new Map<string, BackupNode>();
  for (const n of nodes) if (!byId.has(n.id)) byId.set(n.id, n);

  const alerts: Alert[] = [];
  const adj = new Map<string, string[]>();
  const hasOutgoing = new Set<string>();
  const seenPairs = new Map<string, string>(); // "from\0to" -> first edge id
  const reportedDup = new Set<string>();

  for (const e of edges) {
    const fromNode = byId.get(e.from);
    const toNode = byId.get(e.to);
    if (!fromNode || !toNode) {
      const known = [fromNode && e.from, toNode && e.to].filter((x): x is string => !!x);
      alerts.push({
        id: `structure:dangling:${e.id}`,
        rule: 'structure',
        severity: 'warning',
        message: `Un lien pointe vers un élément inconnu (${!fromNode ? 'origine' : 'destination'} supprimée) — supprimez-le ou reconnectez-le.`,
        nodeIds: known,
      });
      continue;
    }
    if (e.from === e.to) {
      alerts.push({
        id: `structure:self:${e.id}`,
        rule: 'structure',
        severity: 'warning',
        message: `Le lien de "${fromNode.label}" vers lui-même ne crée aucune copie — supprimez-le.`,
        nodeIds: [e.from],
      });
      continue;
    }
    const key = `${e.from}\0${e.to}`;
    const first = seenPairs.get(key);
    if (first !== undefined) {
      if (!reportedDup.has(key)) {
        reportedDup.add(key);
        alerts.push({
          id: `structure:duplicate:${first}`,
          rule: 'structure',
          severity: 'warning',
          message: `Plusieurs liens identiques de "${fromNode.label}" vers "${toNode.label}" — fusionnez-les en un seul.`,
          nodeIds: [e.from, e.to],
        });
      }
    } else {
      seenPairs.set(key, e.id);
    }
    if (!e.schedule || !e.schedule.trim()) {
      alerts.push({
        id: `structure:schedule:${e.id}`,
        rule: 'structure',
        severity: 'info',
        message: `Le lien "${fromNode.label}" → "${toNode.label}" n'a pas de fréquence — précisez-la (ex. Quotidien 02:00).`,
        nodeIds: [e.from, e.to],
      });
    }
    let list = adj.get(e.from);
    if (!list) adj.set(e.from, (list = []));
    list.push(e.to);
    hasOutgoing.add(e.from);
  }

  const sources = nodes.filter((n) => n.kind === 'source');
  const sourceEvals: SourceEvaluation[] = [];
  const reachedByAny = new Set<string>();
  let anyImmutable = false;

  for (const src of sources) {
    // BFS ; cycles tolérés via `visited`
    const visited = new Set<string>([src.id]);
    const queue: string[] = [src.id];
    for (let i = 0; i < queue.length; i++) {
      for (const next of adj.get(queue[i]!) ?? []) {
        if (!visited.has(next)) {
          visited.add(next);
          queue.push(next);
        }
      }
    }
    const reachable: BackupNode[] = [];
    for (const id of queue) {
      const n = byId.get(id);
      if (n && n.kind === 'storage') reachable.push(n);
    }
    for (const n of reachable) reachedByAny.add(n.id);

    const copies = 1 + reachable.length;
    const mediaSet = new Set<MediaType>([src.mediaType]);
    let offsite = src.location === 'offsite' ? 1 : 0;
    let immutable = !!src.immutable;
    for (const n of reachable) {
      mediaSet.add(n.mediaType);
      if (n.location === 'offsite') offsite++;
      if (n.immutable) immutable = true;
    }
    if (immutable) anyImmutable = true;

    const ruleThree = copies >= 3;
    const ruleTwo = mediaSet.size >= 2;
    const ruleOne = offsite >= 1;
    sourceEvals.push({
      sourceId: src.id,
      copies,
      mediaTypes: [...mediaSet],
      offsiteCopies: offsite,
      reachableStorageIds: reachable.map((n) => n.id),
      ruleThree,
      ruleTwo,
      ruleOne,
      compliant: ruleThree && ruleTwo && ruleOne,
    });

    const concerned = [src.id, ...reachable.map((n) => n.id)];
    if (!ruleThree) {
      const missing = 3 - copies;
      alerts.push({
        id: `3:${src.id}`,
        rule: '3',
        severity: 'error',
        message: `Source "${src.label}" : ${copies} ${plural(copies, 'copie', 'copies')} sur 3 requises — ajoutez ${missing} ${plural(missing, 'support', 'supports')} de sauvegarde.`,
        nodeIds: concerned,
        sourceId: src.id,
      });
    }
    if (!ruleTwo) {
      alerts.push({
        id: `2:${src.id}`,
        rule: '2',
        severity: 'error',
        message: `Source "${src.label}" : 1 seul type de support sur 2 requis — ajoutez une copie sur un support de nature différente (ex. NAS, bande, cloud).`,
        nodeIds: concerned,
        sourceId: src.id,
      });
    }
    if (!ruleOne) {
      alerts.push({
        id: `1:${src.id}`,
        rule: '1',
        severity: 'error',
        message: `Source "${src.label}" : aucune copie hors site — ajoutez un support distant (cloud, autre site).`,
        nodeIds: concerned,
        sourceId: src.id,
      });
    }
    if (!hasOutgoing.has(src.id)) {
      alerts.push({
        id: `structure:no-outgoing:${src.id}`,
        rule: 'structure',
        severity: 'warning',
        message: `Source "${src.label}" : aucun lien sortant — reliez-la à un support de sauvegarde.`,
        nodeIds: [src.id],
        sourceId: src.id,
      });
    }
  }

  if (sources.length > 0) {
    for (const n of nodes) {
      if (n.kind === 'storage' && !reachedByAny.has(n.id)) {
        alerts.push({
          id: `structure:orphan:${n.id}`,
          rule: 'structure',
          severity: 'warning',
          message: `Le support "${n.label}" n'est atteignable depuis aucune source — reliez-le ou supprimez-le.`,
          nodeIds: [n.id],
        });
      }
    }
    for (const n of nodes) {
      if (n.kind !== 'storage' || n.encrypted !== false || !reachedByAny.has(n.id)) continue;
      const off = n.location === 'offsite';
      alerts.push({
        id: `encryption:${n.id}`,
        rule: 'encryption',
        severity: off ? 'warning' : 'info',
        message: off
          ? `Le support hors site "${n.label}" n'est pas chiffré — activez le chiffrement : une copie distante non chiffrée expose vos données.`
          : `Le support "${n.label}" n'est pas chiffré — envisagez de le chiffrer.`,
        nodeIds: [n.id],
      });
    }
    if (!anyImmutable) {
      alerts.push({
        id: 'immutable:global',
        rule: 'immutable',
        severity: 'info',
        message: 'Aucune copie immuable/air-gap (3-2-1-1-0) — envisagez une copie WORM ou déconnectée contre les ransomwares.',
        nodeIds: [],
      });
    }
  }

  alerts.sort(
    (a, b) =>
      SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] ||
      (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  );

  let status: ComplianceStatus;
  if (sources.length === 0) status = 'empty';
  else if (alerts.some((a) => a.severity === 'error')) status = 'violation';
  else if (alerts.some((a) => a.severity === 'warning')) status = 'warning';
  else status = 'compliant';

  return { status, sources: sourceEvals, alerts };
}
