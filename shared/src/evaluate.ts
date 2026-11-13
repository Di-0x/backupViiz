import type {
  Alert,
  AlertFix,
  BackupNode,
  ComplianceStatus,
  Evaluation,
  Location,
  MediaType,
  NodeStatus,
  Severity,
  SourceEvaluation,
  StrategyDoc,
} from './types';

const SEVERITY_ORDER: Record<Severity, number> = { error: 0, warning: 1, info: 2 };

function plural(n: number, one: string, many: string): string {
  return n > 1 ? many : one;
}

export interface EvaluateOptions {
  /** Statuts réels reportés par un outil de backup, par id de noeud. Absent = aucune alerte freshness. */
  statuses?: Record<string, NodeStatus>;
  /** Horloge injectée (tests, rendu déterministe). Défaut : maintenant. */
  now?: Date;
}

/** Seuils (jours) des alertes de test de restauration. */
export const RESTORE_STALE_DAYS = 180;
export const RESTORE_VERY_STALE_DAYS = 365;

const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;

/** Types proposés par les corrections automatiques, par ordre de préférence. */
const FIX_MEDIA_PREFERENCE: MediaType[] = ['nas', 'cloud', 'tape', 'usb', 'disk', 'object-storage', 'ssd', 'optical'];
const MEDIA_FR: Record<MediaType, string> = {
  disk: 'Disque',
  ssd: 'SSD',
  nas: 'NAS',
  tape: 'Bande',
  usb: 'Disque USB',
  cloud: 'Cloud',
  'object-storage': 'Stockage objet',
  optical: 'Support optique',
  other: 'Support',
};

/** Parse une date ISO (YYYY-MM-DD ou ISO complète) ; null si invalide. */
function parseTime(v: unknown): number | null {
  if (typeof v !== 'string' || !v.trim()) return null;
  const t = Date.parse(v);
  return Number.isNaN(t) ? null : t;
}

function pickMedia(avoid: Set<MediaType>): MediaType {
  return FIX_MEDIA_PREFERENCE.find((m) => !avoid.has(m)) ?? 'nas';
}

/**
 * Évalue une stratégie selon la règle 3-2-1 (+ restauration et fraîcheur des backups).
 * Fonction pure, déterministe (hors `now` par défaut), O(N+E). `opts` est optionnel (rétrocompatible).
 */
export function evaluate(doc: StrategyDoc, opts: EvaluateOptions = {}): Evaluation {
  const statuses = opts.statuses;
  const nowDate = opts.now instanceof Date && !Number.isNaN(opts.now.getTime()) ? opts.now : new Date();
  const nowMs = nowDate.getTime();
  const strict = doc.options?.rule === '3-2-1-1-0';
  const withOpts = opts.statuses !== undefined || opts.now !== undefined;
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
    const depth = new Map<string, number>([[src.id, 0]]);
    for (let i = 0; i < queue.length; i++) {
      for (const next of adj.get(queue[i]!) ?? []) {
        if (!visited.has(next)) {
          visited.add(next);
          depth.set(next, depth.get(queue[i]!)! + 1);
          queue.push(next);
        }
      }
    }
    // Fin de la chaîne la plus longue (premier noeud le plus profond) ; la source si aucun lien.
    let tailId = src.id;
    let tailDepth = 0;
    for (const id of queue) {
      const d = depth.get(id)!;
      if (d > tailDepth) {
        tailDepth = d;
        tailId = id;
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
    let storageImmutable = false;
    for (const n of reachable) {
      mediaSet.add(n.mediaType);
      if (n.location === 'offsite') offsite++;
      if (n.immutable) (immutable = true, (storageImmutable = true));
    }
    if (immutable) anyImmutable = true;

    const ruleThree = copies >= 3;
    const ruleTwo = mediaSet.size >= 2;
    const ruleOne = offsite >= 1;
    const concerned = [src.id, ...reachable.map((n) => n.id)];
    let latestTest: number | null = null;
    for (const id of concerned) {
      const t = parseTime(byId.get(id)?.lastRestoreTestAt);
      if (t !== null && (latestTest === null || t > latestTest)) latestTest = t;
    }
    const anyFailed = reachable.some((n) => statuses?.[n.id]?.lastStatus === 'failed');
    const ruleImmutable = storageImmutable;
    const ruleZero = latestTest !== null && !anyFailed;
    sourceEvals.push({
      sourceId: src.id,
      copies,
      mediaTypes: [...mediaSet],
      offsiteCopies: offsite,
      reachableStorageIds: reachable.map((n) => n.id),
      ruleThree,
      ruleTwo,
      ruleOne,
      ...(strict ? { ruleImmutable, ruleZero } : {}),
      compliant: ruleThree && ruleTwo && ruleOne && (!strict || (ruleImmutable && ruleZero)),
    });

    const fixLocation: Location = ruleOne ? 'onsite' : 'offsite';
    const fixFor = (mediaType: MediaType, location: Location): AlertFix => ({
      kind: 'add-storage',
      fromId: tailId,
      label: `${MEDIA_FR[mediaType]} — copie de ${src.label}`.slice(0, 80),
      mediaType,
      location,
    });
    if (!ruleThree) {
      const missing = 3 - copies;
      alerts.push({
        id: `3:${src.id}`,
        rule: '3',
        severity: 'error',
        message: `Source "${src.label}" : ${copies} ${plural(copies, 'copie', 'copies')} sur 3 requises — ajoutez ${missing} ${plural(missing, 'support', 'supports')} de sauvegarde.`,
        nodeIds: concerned,
        sourceId: src.id,
        fix: fixFor(pickMedia(mediaSet), fixLocation),
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
        fix: fixFor(pickMedia(mediaSet), fixLocation),
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
        fix: fixFor('cloud', 'offsite'),
      });
    }

    // Test de restauration : un test sur la source ou sur n'importe quel support atteignable la couvre.
    // On retient le plus récent des tests valides (dates invalides ignorées).
    if (strict && !ruleImmutable) {
      alerts.push({
        id: `immutable:${src.id}`,
        rule: 'immutable',
        severity: 'error',
        message: `Source "${src.label}" : aucune copie immuable ou hors ligne (le « 1 » de 3-2-1-1-0) — ajoutez une copie WORM / air-gap, protégée d'un rançongiciel.`,
        nodeIds: concerned,
        sourceId: src.id,
        fix: { kind: 'add-storage', fromId: tailId, label: `Cloud immuable — copie de ${src.label}`.slice(0, 80), mediaType: 'cloud', location: 'offsite', immutable: true },
      });
    }
    if (latestTest === null) {
      if (strict || withOpts) {
        alerts.push({
          id: `restore:${src.id}`,
          rule: 'restore',
          severity: strict ? 'error' : 'info',
          message: `Source "${src.label}" : restauration jamais testée — restaurez un fichier depuis une sauvegarde et notez la date du test.`,
          nodeIds: concerned,
          sourceId: src.id,
        });
      }
    } else {
      const days = Math.floor((nowMs - latestTest) / DAY_MS);
      if (days > RESTORE_VERY_STALE_DAYS) {
        alerts.push({
          id: `restore:${src.id}`,
          rule: 'restore',
          severity: strict ? 'error' : 'warning',
          message: `Source "${src.label}" : dernier test de restauration il y a ${days} jours (plus d'un an) — une sauvegarde non testée n'est pas fiable, testez une restauration dès maintenant.`,
          nodeIds: concerned,
          sourceId: src.id,
        });
      } else if (days > RESTORE_STALE_DAYS) {
        alerts.push({
          id: `restore:${src.id}`,
          rule: 'restore',
          severity: 'warning',
          message: `Source "${src.label}" : dernier test de restauration il y a ${days} jours (plus de 6 mois) — refaites un test de restauration.`,
          nodeIds: concerned,
          sourceId: src.id,
        });
      }
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
          fix: { kind: 'connect', fromId: sources[0]!.id, toId: n.id },
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
    if (statuses) {
      for (const n of nodes) {
        if (n.kind !== 'storage' || !reachedByAny.has(n.id)) continue;
        const st = Object.prototype.hasOwnProperty.call(statuses, n.id) ? statuses[n.id] : undefined;
        if (!st) continue;
        if (st.lastStatus === 'failed') {
          alerts.push({
            id: `freshness:${n.id}`,
            rule: 'freshness',
            severity: 'error',
            message: `Le dernier backup vers "${n.label}" a échoué${st.message ? ` (${st.message})` : ''} — consultez les journaux de l'outil de sauvegarde et relancez-le.`,
            nodeIds: [n.id],
          });
          continue;
        }
        const limit = n.staleAfterHours;
        if (typeof limit !== 'number' || !Number.isFinite(limit) || limit <= 0) continue;
        const last = parseTime(st.lastSuccessAt);
        if (last === null) {
          alerts.push({
            id: `freshness:${n.id}`,
            rule: 'freshness',
            severity: 'error',
            message: `Aucun backup réussi reporté pour "${n.label}" (seuil : ${limit} h) — vérifiez que la sauvegarde s'exécute.`,
            nodeIds: [n.id],
          });
        } else if (nowMs - last > limit * HOUR_MS) {
          const hours = Math.floor((nowMs - last) / HOUR_MS);
          alerts.push({
            id: `freshness:${n.id}`,
            rule: 'freshness',
            severity: 'error',
            message: `Aucun backup réussi depuis ${hours} h vers "${n.label}" (seuil : ${limit} h) — vérifiez la planification et les journaux.`,
            nodeIds: [n.id],
          });
        }
      }
    }
    if (!strict && !anyImmutable) {
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

  return { rule: strict ? '3-2-1-1-0' : '3-2-1', status, sources: sourceEvals, alerts };
}
