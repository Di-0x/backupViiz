import { create } from 'zustand';
import { evaluate } from '@backupviiz/shared';
import type { AlertFix, BackupEdge, BackupNode, Evaluation, NodeStatus, Strategy, StrategyDoc } from '@backupviiz/shared';
import type { PaletteItem } from './presets';

const HISTORY_LIMIT = 100;

type Statuses = Record<string, NodeStatus>;
const evalWith = evaluate as (doc: StrategyDoc, opts?: { statuses?: Statuses; now?: Date }) => Evaluation;
/** Évaluation locale tenant compte des statuts réels reportés. */
const evaluateDoc = (doc: StrategyDoc, statuses: Statuses): Evaluation => evalWith(doc, { statuses });
const COALESCE_MS = 900;

export function uid(prefix: string): string {
  const r =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID().replace(/-/g, '').slice(0, 10)
      : Math.random().toString(36).slice(2, 12);
  return `${prefix}_${r}`;
}

/** Disposition simple gauche→droite par profondeur depuis les sources. */
export function layoutDoc(doc: StrategyDoc): BackupNode[] {
  const ids = new Set(doc.nodes.map((n) => n.id));
  const out = new Map<string, string[]>();
  for (const e of doc.edges) {
    if (!ids.has(e.from) || !ids.has(e.to) || e.from === e.to) continue;
    (out.get(e.from) ?? out.set(e.from, []).get(e.from)!).push(e.to);
  }
  const depth = new Map<string, number>();
  const queue: string[] = [];
  for (const n of doc.nodes) if (n.kind === 'source') (depth.set(n.id, 0), queue.push(n.id));
  for (let i = 0; i < queue.length; i++) {
    const id = queue[i]!;
    for (const t of out.get(id) ?? []) {
      if (!depth.has(t)) (depth.set(t, depth.get(id)! + 1), queue.push(t));
    }
  }
  const maxD = Math.max(0, ...depth.values());
  const cols = new Map<number, BackupNode[]>();
  for (const n of doc.nodes) {
    const d = depth.get(n.id) ?? maxD + 1;
    (cols.get(d) ?? cols.set(d, []).get(d)!).push(n);
  }
  const pos = new Map<string, { x: number; y: number }>();
  const colKeys = [...cols.keys()].sort((a, b) => a - b);
  colKeys.forEach((d, ci) => {
    const list = cols.get(d)!.slice().sort((a, b) => a.position.y - b.position.y || a.position.x - b.position.x);
    list.forEach((n, i) => pos.set(n.id, { x: ci * 260, y: i * 140 }));
  });
  const maxRows = Math.max(1, ...[...cols.values()].map((l) => l.length));
  // centre verticalement chaque colonne
  for (const d of colKeys) {
    const list = cols.get(d)!;
    const off = ((maxRows - list.length) * 140) / 2;
    const snapped = Math.round(off / 20) * 20;
    for (const n of list) pos.get(n.id)!.y += snapped;
  }
  return doc.nodes.map((n) => ({ ...n, position: pos.get(n.id) ?? n.position }));
}

interface Snapshot {
  doc: StrategyDoc;
}

export interface EditorState {
  id: string | null;
  name: string;
  description: string;
  doc: StrategyDoc;
  evaluation: Evaluation;
  /** Statuts réels reportés (lecture seule, jamais renvoyés au PUT). */
  statuses: Statuses;
  selectedNodeIds: string[];
  selectedEdgeIds: string[];
  highlightedNodeIds: string[];
  /** Incrémenté à chaque modification à persister (nom, description, doc). */
  rev: number;
  past: Snapshot[];
  future: Snapshot[];
  lastKey: string | null;
  lastKeyAt: number;
  focusRequest: { ids: string[]; n: number } | null;
  /** Position visible (flow) où ajouter un nœud par clic palette ; fournie par le canvas. */
  getViewportCenter: (() => { x: number; y: number }) | null;

  load: (s: Strategy) => void;
  reset: () => void;
  setName: (name: string) => void;
  beginGesture: () => void;
  moveNodes: (positions: Record<string, { x: number; y: number }>) => void;
  addNode: (item: PaletteItem, at?: { x: number; y: number }) => string;
  updateNode: (id: string, patch: Partial<BackupNode>) => void;
  updateEdge: (id: string, patch: Partial<BackupEdge>) => void;
  connect: (from: string, to: string) => string | null;
  /** Applique une correction proposée par une alerte (une seule étape d'annulation). Renvoie l'id du noeud créé ou null. */
  applyFix: (fix: AlertFix) => string | null;
  reverseEdge: (id: string) => void;
  deleteMany: (nodeIds: string[], edgeIds: string[]) => void;
  deleteSelection: () => void;
  duplicateSelection: () => void;
  autoLayout: () => void;
  select: (nodeIds: string[], edgeIds?: string[]) => void;
  setSelection: (s: { nodeIds?: string[]; edgeIds?: string[] }) => void;
  highlight: (ids: string[] | null) => void;
  requestFocus: (ids: string[]) => void;
  undo: () => void;
  redo: () => void;
}

const EMPTY_DOC: StrategyDoc = { nodes: [], edges: [] };
const EMPTY_EVAL: Evaluation = { status: 'empty', sources: [], alerts: [] };

export const useEditor = create<EditorState>((set, get) => {
  /** Applique un changement de doc avec historique (coalescé si `key` identique). */
  function commit(next: StrategyDoc, key?: string, extra?: Partial<EditorState>) {
    const s = get();
    const now = Date.now();
    const coalesce = key != null && key === s.lastKey && now - s.lastKeyAt < COALESCE_MS;
    const past = coalesce ? s.past : [...s.past, { doc: s.doc }].slice(-HISTORY_LIMIT);
    set({
      doc: next,
      evaluation: evaluateDoc(next, s.statuses),
      past,
      future: [],
      rev: s.rev + 1,
      lastKey: key ?? null,
      lastKeyAt: now,
      ...extra,
    });
  }

  /** Nettoie la sélection pour ne garder que des éléments existants. */
  function prune(doc: StrategyDoc, nodeIds: string[], edgeIds: string[]) {
    const n = new Set(doc.nodes.map((x) => x.id));
    const e = new Set(doc.edges.map((x) => x.id));
    return { selectedNodeIds: nodeIds.filter((i) => n.has(i)), selectedEdgeIds: edgeIds.filter((i) => e.has(i)) };
  }

  return {
    id: null,
    name: '',
    description: '',
    doc: EMPTY_DOC,
    evaluation: EMPTY_EVAL,
    statuses: {},
    selectedNodeIds: [],
    selectedEdgeIds: [],
    highlightedNodeIds: [],
    rev: 0,
    past: [],
    future: [],
    lastKey: null,
    lastKeyAt: 0,
    focusRequest: null,
    getViewportCenter: null,

    load: (s) =>
      set({
        id: s.id,
        name: s.name,
        description: s.description,
        doc: { nodes: s.nodes, edges: s.edges },
        evaluation: evaluateDoc({ nodes: s.nodes, edges: s.edges }, s.statuses ?? {}),
        statuses: s.statuses ?? {},
        selectedNodeIds: [],
        selectedEdgeIds: [],
        highlightedNodeIds: [],
        past: [],
        future: [],
        lastKey: null,
        rev: 0,
      }),
    reset: () =>
      set({ id: null, name: '', doc: EMPTY_DOC, evaluation: EMPTY_EVAL, statuses: {}, past: [], future: [], selectedNodeIds: [], selectedEdgeIds: [], rev: 0, highlightedNodeIds: [] }),

    setName: (name) => set((s) => ({ name, rev: s.rev + 1 })),

    beginGesture: () => set({ lastKey: null }),

    moveNodes: (positions) => {
      const s = get();
      // Un geste de déplacement = une entrée d'historique (clé de coalescence).
      const key = 'move';
      const nodes = s.doc.nodes.map((n) => (positions[n.id] ? { ...n, position: positions[n.id]! } : n));
      commit({ ...s.doc, nodes }, key);
    },

    addNode: (item, at) => {
      const s = get();
      const base = at ?? s.getViewportCenter?.() ?? { x: 0, y: 0 };
      // décale si une carte occupe déjà l'emplacement
      let x = Math.round(base.x / 20) * 20;
      let y = Math.round(base.y / 20) * 20;
      while (s.doc.nodes.some((n) => Math.abs(n.position.x - x) < 40 && Math.abs(n.position.y - y) < 40)) {
        x += 40;
        y += 40;
      }
      const sameKind = s.doc.nodes.filter((n) => n.kind === item.kind).length;
      const label = item.kind === 'source' && sameKind > 0 ? `${item.label} ${sameKind + 1}` : item.label;
      const node: BackupNode = {
        id: uid('n'),
        kind: item.kind,
        label: label.slice(0, 80),
        mediaType: item.mediaType,
        location: item.location,
        position: { x, y },
      };
      commit({ ...s.doc, nodes: [...s.doc.nodes, node] }, undefined, { selectedNodeIds: [node.id], selectedEdgeIds: [] });
      return node.id;
    },

    updateNode: (id, patch) => {
      const s = get();
      const keys = Object.keys(patch).sort().join(',');
      const nodes = s.doc.nodes.map((n) => (n.id === id ? { ...n, ...patch, id: n.id } : n));
      commit({ ...s.doc, nodes }, `node:${id}:${keys}`);
    },

    updateEdge: (id, patch) => {
      const s = get();
      const keys = Object.keys(patch).sort().join(',');
      const edges = s.doc.edges.map((e) => (e.id === id ? { ...e, ...patch, id: e.id } : e));
      commit({ ...s.doc, edges }, `edge:${id}:${keys}`);
    },

    connect: (from, to) => {
      const s = get();
      if (from === to || s.doc.edges.some((e) => e.from === from && e.to === to)) return null;
      const edge: BackupEdge = { id: uid('e'), from, to };
      commit({ ...s.doc, edges: [...s.doc.edges, edge] }, undefined, { selectedNodeIds: [], selectedEdgeIds: [edge.id] });
      return edge.id;
    },

    applyFix: (fix) => {
      const s = get();
      const from = s.doc.nodes.find((n) => n.id === fix.fromId);
      if (!from) return null;
      if (fix.kind === 'connect') {
        const to = s.doc.nodes.find((n) => n.id === fix.toId);
        if (!to || fix.fromId === fix.toId || s.doc.edges.some((e) => e.from === fix.fromId && e.to === fix.toId)) return null;
        const edge: BackupEdge = { id: uid('e'), from: fix.fromId, to: fix.toId };
        commit({ ...s.doc, edges: [...s.doc.edges, edge] }, undefined, { selectedNodeIds: [], selectedEdgeIds: [edge.id] });
        return null;
      }
      let x = Math.round((from.position.x + 260) / 20) * 20;
      let y = Math.round(from.position.y / 20) * 20;
      while (s.doc.nodes.some((n) => Math.abs(n.position.x - x) < 40 && Math.abs(n.position.y - y) < 40)) y += 140;
      const node: BackupNode = {
        id: uid('n'),
        kind: 'storage',
        label: fix.label.slice(0, 80),
        mediaType: fix.mediaType,
        location: fix.location,
        position: { x, y },
      };
      const edge: BackupEdge = { id: uid('e'), from: from.id, to: node.id };
      commit({ nodes: [...s.doc.nodes, node], edges: [...s.doc.edges, edge] }, undefined, {
        selectedNodeIds: [node.id],
        selectedEdgeIds: [],
        focusRequest: { ids: [node.id], n: (s.focusRequest?.n ?? 0) + 1 },
      });
      return node.id;
    },

    reverseEdge: (id) => {
      const s = get();
      commit({ ...s.doc, edges: s.doc.edges.map((e) => (e.id === id ? { ...e, from: e.to, to: e.from } : e)) });
    },

    deleteMany: (nodeIds, edgeIds) => {
      const s = get();
      if (!nodeIds.length && !edgeIds.length) return;
      const nset = new Set(nodeIds);
      const eset = new Set(edgeIds);
      const next: StrategyDoc = {
        nodes: s.doc.nodes.filter((n) => !nset.has(n.id)),
        edges: s.doc.edges.filter((e) => !eset.has(e.id) && !nset.has(e.from) && !nset.has(e.to)),
      };
      commit(next, undefined, prune(next, s.selectedNodeIds, s.selectedEdgeIds));
    },

    deleteSelection: () => {
      const s = get();
      s.deleteMany(s.selectedNodeIds, s.selectedEdgeIds);
    },

    duplicateSelection: () => {
      const s = get();
      const sel = new Set(s.selectedNodeIds);
      if (!sel.size) return;
      const map = new Map<string, string>();
      const copies: BackupNode[] = [];
      for (const n of s.doc.nodes) {
        if (!sel.has(n.id)) continue;
        const id = uid('n');
        map.set(n.id, id);
        copies.push({ ...n, id, label: `${n.label} (copie)`.slice(0, 80), position: { x: n.position.x + 40, y: n.position.y + 60 } });
      }
      const edges: BackupEdge[] = s.doc.edges
        .filter((e) => map.has(e.from) && map.has(e.to))
        .map((e) => ({ ...e, id: uid('e'), from: map.get(e.from)!, to: map.get(e.to)! }));
      commit({ nodes: [...s.doc.nodes, ...copies], edges: [...s.doc.edges, ...edges] }, undefined, {
        selectedNodeIds: copies.map((c) => c.id),
        selectedEdgeIds: [],
      });
    },

    autoLayout: () => {
      const s = get();
      if (!s.doc.nodes.length) return;
      commit({ ...s.doc, nodes: layoutDoc(s.doc) }, undefined, { focusRequest: { ids: [], n: (s.focusRequest?.n ?? 0) + 1 } });
    },

    select: (nodeIds, edgeIds = []) => set({ selectedNodeIds: nodeIds, selectedEdgeIds: edgeIds }),
    setSelection: ({ nodeIds, edgeIds }) =>
      set((s) => ({ selectedNodeIds: nodeIds ?? s.selectedNodeIds, selectedEdgeIds: edgeIds ?? s.selectedEdgeIds })),
    highlight: (ids) => set({ highlightedNodeIds: ids ?? [] }),
    requestFocus: (ids) => set((s) => ({ focusRequest: { ids, n: (s.focusRequest?.n ?? 0) + 1 } })),

    undo: () => {
      const s = get();
      const prev = s.past[s.past.length - 1];
      if (!prev) return;
      set({
        doc: prev.doc,
        evaluation: evaluateDoc(prev.doc, s.statuses),
        past: s.past.slice(0, -1),
        future: [{ doc: s.doc }, ...s.future].slice(0, HISTORY_LIMIT),
        rev: s.rev + 1,
        lastKey: null,
        ...prune(prev.doc, s.selectedNodeIds, s.selectedEdgeIds),
      });
    },
    redo: () => {
      const s = get();
      const next = s.future[0];
      if (!next) return;
      set({
        doc: next.doc,
        evaluation: evaluateDoc(next.doc, s.statuses),
        past: [...s.past, { doc: s.doc }].slice(-HISTORY_LIMIT),
        future: s.future.slice(1),
        rev: s.rev + 1,
        lastKey: null,
        ...prune(next.doc, s.selectedNodeIds, s.selectedEdgeIds),
      });
    },
  };
});
