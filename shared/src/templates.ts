import type { BackupEdge, BackupNode, MediaType, StrategyDoc } from './types';

export interface StrategyTemplate {
  id: string;
  name: string;
  description: string;
  doc: StrategyDoc;
}

const X = 260;
const Y = 140;

function node(
  id: string,
  kind: BackupNode['kind'],
  label: string,
  mediaType: MediaType,
  location: BackupNode['location'],
  col: number,
  row: number,
  extra: Partial<BackupNode> = {},
): BackupNode {
  return { id, kind, label, mediaType, location, position: { x: col * X, y: row * Y }, ...extra };
}

function edge(id: string, from: string, to: string, method?: string, schedule?: string): BackupEdge {
  const e: BackupEdge = { id, from, to };
  if (method) e.method = method;
  if (schedule) e.schedule = schedule;
  return e;
}

export const TEMPLATES: StrategyTemplate[] = [
  {
    id: 'empty',
    name: 'Vide',
    description: 'Page blanche : ajoutez vos sources et supports.',
    doc: { nodes: [], edges: [] },
  },
  {
    id: 'classic-321',
    name: '3-2-1 classique (PC → NAS → Cloud)',
    description: 'Un PC sauvegardé sur un NAS local, répliqué vers un cloud distant.',
    doc: {
      nodes: [
        node('pc', 'source', 'PC portable', 'ssd', 'onsite', 0, 1),
        node('nas', 'storage', 'NAS maison', 'nas', 'onsite', 1, 1),
        node('cloud', 'storage', 'Cloud (stockage objet)', 'cloud', 'offsite', 2, 1),
      ],
      edges: [
        edge('e1', 'pc', 'nas', 'restic', 'Quotidien 02:00'),
        edge('e2', 'nas', 'cloud', 'rclone', 'Hebdomadaire dimanche 04:00'),
      ],
    },
  },
  {
    id: 'sme',
    name: 'PME : serveur + NAS + bande + cloud immuable',
    description: 'Serveur de production, NAS local, bande hebdomadaire et copie cloud immuable.',
    doc: {
      nodes: [
        node('srv', 'source', 'Serveur de production', 'ssd', 'onsite', 0, 1),
        node('nas', 'storage', 'NAS de sauvegarde', 'nas', 'onsite', 1, 0),
        node('tape', 'storage', 'Bandes LTO (coffre externe)', 'tape', 'offsite', 2, 0),
        node('cloud', 'storage', 'Cloud immuable (WORM)', 'object-storage', 'offsite', 2, 2, {
          immutable: true,
        }),
      ],
      edges: [
        edge('e1', 'srv', 'nas', 'veeam', 'Quotidien 22:00'),
        edge('e2', 'nas', 'tape', 'veeam', 'Hebdomadaire vendredi 20:00'),
        edge('e3', 'srv', 'cloud', 'veeam', 'Quotidien 01:00'),
      ],
    },
  },
  {
    id: 'non-compliant',
    name: 'Non conforme (exemple)',
    description: "Exemple volontairement incomplet pour découvrir les alertes : une seule copie locale et un support orphelin.",
    doc: {
      nodes: [
        node('pc', 'source', 'PC bureau', 'disk', 'onsite', 0, 1),
        node('usb', 'storage', 'Disque USB', 'disk', 'onsite', 1, 1),
        node('old', 'storage', 'Ancien NAS', 'nas', 'onsite', 2, 2),
      ],
      edges: [edge('e1', 'pc', 'usb', 'copie manuelle')],
    },
  },
];

let counter = 0;

function freshId(prefix: string): string {
  counter = (counter + 1) % 1_000_000;
  const rnd = Math.random().toString(36).slice(2, 8);
  return `${prefix}-${Date.now().toString(36)}${counter.toString(36)}${rnd}`;
}

/** Copie profonde du document du template avec des ids uniques (références des liens remappées). */
export function instantiateTemplate(t: Pick<StrategyTemplate, 'doc'>): StrategyDoc {
  const map = new Map<string, string>();
  const nodes = t.doc.nodes.map((n) => {
    const id = freshId('n');
    map.set(n.id, id);
    return { ...n, id, position: { ...n.position } };
  });
  const edges = t.doc.edges.map((e) => ({
    ...e,
    id: freshId('e'),
    from: map.get(e.from) ?? e.from,
    to: map.get(e.to) ?? e.to,
  }));
  return { nodes, edges };
}
