import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { DragEvent, MouseEvent as ReactMouseEvent } from 'react';
import {
  Background,
  BackgroundVariant,
  Controls,
  MarkerType,
  MiniMap,
  ReactFlow,
  useReactFlow,
} from '@xyflow/react';
import type { Connection, EdgeChange, NodeChange, NodeTypes, EdgeTypes } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { MEDIA_META } from './panels';
import { SourceNode, StorageNode } from './nodes';
import type { BackupFlowNode } from './nodes';
import { BackupEdgeView } from './edges';
import type { BackupFlowEdge } from './edges';
import { useEditor } from './store';
import { DRAG_MIME, SOURCE_ITEMS, STORAGE_ITEMS } from './presets';
import type { PaletteItem } from './presets';

const nodeTypes: NodeTypes = { source: SourceNode, storage: StorageNode };
const edgeTypes: EdgeTypes = { backup: BackupEdgeView };
const SNAP: [number, number] = [20, 20];
const DEFAULT_SOURCE = SOURCE_ITEMS[0]!;
const DEFAULT_STORAGE = STORAGE_ITEMS[2]!;

type Menu =
  | { x: number; y: number; type: 'pane'; flow: { x: number; y: number } }
  | { x: number; y: number; type: 'node'; id: string }
  | { x: number; y: number; type: 'edge'; id: string };

type MenuSpec = Menu extends infer M ? (M extends Menu ? Omit<M, 'x' | 'y'> : never) : never;

const reducedMotion = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

export default function Canvas() {
  const doc = useEditor((s) => s.doc);
  const evaluation = useEditor((s) => s.evaluation);
  const selectedNodeIds = useEditor((s) => s.selectedNodeIds);
  const selectedEdgeIds = useEditor((s) => s.selectedEdgeIds);
  const highlighted = useEditor((s) => s.highlightedNodeIds);
  const focusRequest = useEditor((s) => s.focusRequest);
  const rf = useReactFlow();
  const wrapRef = useRef<HTMLDivElement>(null);
  const [menu, setMenu] = useState<Menu | null>(null);
  const [dims, setDims] = useState<Record<string, { width: number; height: number }>>({});

  // Centre visible, utilisé par le clic palette.
  useEffect(() => {
    useEditor.setState({
      getViewportCenter: () => {
        const r = wrapRef.current?.getBoundingClientRect();
        if (!r) return { x: 0, y: 0 };
        const p = rf.screenToFlowPosition({ x: r.left + r.width / 2, y: r.top + r.height / 2 });
        return { x: p.x - 90, y: p.y - 40 };
      },
    });
    return () => useEditor.setState({ getViewportCenter: null });
  }, [rf]);

  useEffect(() => {
    if (!focusRequest) return;
    const duration = reducedMotion() ? 0 : 300;
    const ids = focusRequest.ids;
    void rf.fitView({ nodes: ids.length ? ids.map((id) => ({ id })) : undefined, maxZoom: ids.length ? 1.2 : 1.1, padding: 0.25, duration });
  }, [focusRequest, rf]);

  const { copyNumbers, severities } = useMemo(() => {
    const ids = new Set(doc.nodes.map((n) => n.id));
    const out = new Map<string, string[]>();
    for (const e of doc.edges) {
      if (ids.has(e.from) && ids.has(e.to)) (out.get(e.from) ?? out.set(e.from, []).get(e.from)!).push(e.to);
    }
    const copyNumbers = new Map<string, number>();
    const q: string[] = [];
    for (const n of doc.nodes) if (n.kind === 'source') (copyNumbers.set(n.id, 1), q.push(n.id));
    for (let i = 0; i < q.length; i++) {
      for (const t of out.get(q[i]!) ?? []) {
        if (!copyNumbers.has(t)) (copyNumbers.set(t, copyNumbers.get(q[i]!)! + 1), q.push(t));
      }
    }
    const severities = new Map<string, 'error' | 'warning'>();
    for (const a of evaluation.alerts) {
      if (a.severity === 'info') continue;
      for (const id of a.nodeIds) if (a.severity === 'error' || !severities.has(id)) severities.set(id, a.severity);
    }
    return { copyNumbers, severities };
  }, [doc, evaluation.alerts]);

  const nodes = useMemo<BackupFlowNode[]>(() => {
    const sel = new Set(selectedNodeIds);
    const hl = new Set(highlighted);
    return doc.nodes.map((n) => {
      const d = dims[n.id];
      return {
        id: n.id,
        type: n.kind,
        position: n.position,
        selected: sel.has(n.id),
        ariaRole: 'group',
        ariaLabel: `${n.kind === 'source' ? 'Source' : 'Support'} ${n.label}, ${MEDIA_META[n.mediaType].label}, ${
          n.location === 'offsite' ? 'hors site' : 'sur site'
        }${severities.get(n.id) === 'error' ? ', non conforme' : ''}`,
        measured: d,
        data: { node: n, copy: copyNumbers.get(n.id), severity: severities.get(n.id), highlighted: hl.has(n.id) },
      };
    });
  }, [doc.nodes, selectedNodeIds, highlighted, dims, copyNumbers, severities]);

  const edges = useMemo<BackupFlowEdge[]>(() => {
    const ids = new Set(doc.nodes.map((n) => n.id));
    const sel = new Set(selectedEdgeIds);
    return doc.edges
      .filter((e) => ids.has(e.from) && ids.has(e.to))
      .map((e) => ({
        id: e.id,
        type: 'backup',
        source: e.from,
        target: e.to,
        selected: sel.has(e.id),
        animated: true,
        markerEnd: { type: MarkerType.ArrowClosed, width: 18, height: 18 },
        ariaLabel: `Lien de sauvegarde${e.method ? ` ${e.method}` : ''}${e.schedule ? `, ${e.schedule}` : ''}`,
        data: { method: e.method, schedule: e.schedule, missingSchedule: !e.schedule },
      }));
  }, [doc.edges, doc.nodes, selectedEdgeIds]);

  const onNodesChange = useCallback((changes: NodeChange<BackupFlowNode>[]) => {
    const st = useEditor.getState();
    const moved: Record<string, { x: number; y: number }> = {};
    let sel: Set<string> | null = null;
    let newDims: Record<string, { width: number; height: number }> | null = null;
    const removed: string[] = [];
    for (const c of changes) {
      if (c.type === 'position' && c.position) moved[c.id] = { x: Math.round(c.position.x), y: Math.round(c.position.y) };
      else if (c.type === 'select') (sel ??= new Set(st.selectedNodeIds))[c.selected ? 'add' : 'delete'](c.id);
      else if (c.type === 'dimensions' && c.dimensions) {
        (newDims ??= {})[c.id] = { width: c.dimensions.width, height: c.dimensions.height };
      } else if (c.type === 'remove') removed.push(c.id);
    }
    if (Object.keys(moved).length) st.moveNodes(moved);
    if (sel) st.setSelection({ nodeIds: [...sel] });
    if (removed.length) st.deleteMany(removed, []);
    if (newDims) {
      const nd = newDims;
      setDims((prev) => {
        let changed = false;
        const next = { ...prev };
        for (const [id, d] of Object.entries(nd)) {
          const p = prev[id];
          if (!p || p.width !== d.width || p.height !== d.height) (next[id] = d, (changed = true));
        }
        return changed ? next : prev;
      });
    }
  }, []);

  const onEdgesChange = useCallback((changes: EdgeChange<BackupFlowEdge>[]) => {
    const st = useEditor.getState();
    let sel: Set<string> | null = null;
    const removed: string[] = [];
    for (const c of changes) {
      if (c.type === 'select') (sel ??= new Set(st.selectedEdgeIds))[c.selected ? 'add' : 'delete'](c.id);
      else if (c.type === 'remove') removed.push(c.id);
    }
    if (sel) st.setSelection({ edgeIds: [...sel] });
    if (removed.length) st.deleteMany([], removed);
  }, []);

  const onConnect = useCallback((c: Connection) => {
    if (c.source && c.target) useEditor.getState().connect(c.source, c.target);
  }, []);

  const isValidConnection = useCallback(
    (c: { source: string; target: string }) => {
      if (c.source === c.target) return false;
      const t = doc.nodes.find((n) => n.id === c.target);
      return !!t && t.kind === 'storage';
    },
    [doc.nodes],
  );

  const onDragOver = useCallback((e: DragEvent) => {
    if (e.dataTransfer.types.includes(DRAG_MIME)) {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
    }
  }, []);
  const onDrop = useCallback(
    (e: DragEvent) => {
      const raw = e.dataTransfer.getData(DRAG_MIME);
      if (!raw) return;
      e.preventDefault();
      try {
        const item = JSON.parse(raw) as PaletteItem;
        const p = rf.screenToFlowPosition({ x: e.clientX, y: e.clientY });
        useEditor.getState().addNode(item, { x: p.x - 90, y: p.y - 40 });
      } catch {
        /* charge utile invalide : ignorée */
      }
    },
    [rf],
  );

  const onDoubleClick = useCallback(
    (e: ReactMouseEvent) => {
      if (!(e.target as HTMLElement).classList.contains('react-flow__pane')) return;
      const p = rf.screenToFlowPosition({ x: e.clientX, y: e.clientY });
      useEditor.getState().addNode(e.shiftKey ? DEFAULT_SOURCE : DEFAULT_STORAGE, { x: p.x - 90, y: p.y - 40 });
    },
    [rf],
  );

  const openMenu = useCallback((e: ReactMouseEvent | MouseEvent, m: MenuSpec) => {
    e.preventDefault();
    const r = wrapRef.current?.getBoundingClientRect();
    setMenu({ ...(m as Menu), x: e.clientX - (r?.left ?? 0), y: e.clientY - (r?.top ?? 0) });
  }, []);

  return (
    <div className="bv-canvas" ref={wrapRef} onDragOver={onDragOver} onDrop={onDrop} onDoubleClick={onDoubleClick}>
      <ReactFlow<BackupFlowNode, BackupFlowEdge>
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        isValidConnection={isValidConnection}
        onNodeDragStart={() => useEditor.getState().beginGesture()}
        onPaneClick={() => {
          setMenu(null);
          useEditor.getState().select([], []);
        }}
        onPaneContextMenu={(e) => openMenu(e, { type: 'pane', flow: rf.screenToFlowPosition({ x: e.clientX, y: e.clientY }) })}
        onNodeContextMenu={(e, n) => {
          const st = useEditor.getState();
          if (!st.selectedNodeIds.includes(n.id)) st.select([n.id]);
          openMenu(e, { type: 'node', id: n.id });
        }}
        onEdgeContextMenu={(e, ed) => {
          useEditor.getState().select([], [ed.id]);
          openMenu(e, { type: 'edge', id: ed.id });
        }}
        onMoveStart={() => setMenu(null)}
        snapToGrid
        snapGrid={SNAP}
        fitView
        fitViewOptions={{ padding: 0.25, maxZoom: 1.1 }}
        minZoom={0.2}
        maxZoom={2}
        zoomOnDoubleClick={false}
        deleteKeyCode={['Delete', 'Backspace']}
        multiSelectionKeyCode={['Shift', 'Meta', 'Control']}
        selectionOnDrag={false}
        connectionRadius={36}
        proOptions={{ hideAttribution: true }}
        ariaLabelConfig={{ 'node.a11yDescription.default': 'Appuyez sur Entrée pour sélectionner, flèches pour déplacer, Suppr pour supprimer.' }}
      >
        <Background variant={BackgroundVariant.Dots} gap={20} size={1.2} />
        <Controls showInteractive={false} position="bottom-left" />
        <MiniMap pannable zoomable className="bv-minimap" ariaLabel="Mini-carte du diagramme" nodeStrokeWidth={2} />
      </ReactFlow>

      {doc.nodes.length === 0 && (
        <div className="bv-empty" role="note">
          <strong>Diagramme vide</strong>
          <span>
            Glissez un élément depuis la palette, double-cliquez sur le fond (Maj + double-clic : source), ou appuyez sur <kbd>N</kbd> (source) / <kbd>S</kbd> (support).
          </span>
        </div>
      )}

      {menu && <ContextMenu menu={menu} onClose={() => setMenu(null)} />}
    </div>
  );
}

function ContextMenu({ menu, onClose }: { menu: Menu; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const st = useEditor.getState;
  useEffect(() => {
    ref.current?.querySelector<HTMLButtonElement>('button')?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        const btns = [...(ref.current?.querySelectorAll<HTMLButtonElement>('button') ?? [])];
        const i = btns.indexOf(document.activeElement as HTMLButtonElement);
        btns[(i + (e.key === 'ArrowDown' ? 1 : -1) + btns.length) % btns.length]?.focus();
      }
    };
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) onClose();
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onDown);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onDown);
    };
  }, [onClose]);

  const run = (fn: () => void) => () => {
    fn();
    onClose();
  };
  const items: { label: string; danger?: boolean; fn: () => void }[] =
    menu.type === 'pane'
      ? [
          { label: 'Ajouter une source ici', fn: () => st().addNode(DEFAULT_SOURCE, { x: menu.flow.x - 90, y: menu.flow.y - 40 }) },
          { label: 'Ajouter un support ici', fn: () => st().addNode(DEFAULT_STORAGE, { x: menu.flow.x - 90, y: menu.flow.y - 40 }) },
          { label: 'Réorganiser automatiquement', fn: () => st().autoLayout() },
        ]
      : menu.type === 'node'
        ? [
            { label: 'Dupliquer', fn: () => st().duplicateSelection() },
            { label: 'Supprimer', danger: true, fn: () => st().deleteSelection() },
          ]
        : [
            { label: 'Inverser le sens', fn: () => st().reverseEdge(menu.id) },
            { label: 'Supprimer le lien', danger: true, fn: () => st().deleteMany([], [menu.id]) },
          ];
  return (
    <div ref={ref} className="bv-menu" role="menu" style={{ left: menu.x, top: menu.y }}>
      {items.map((it) => (
        <button key={it.label} role="menuitem" type="button" className={it.danger ? 'is-danger' : ''} onClick={run(it.fn)}>
          {it.label}
        </button>
      ))}
    </div>
  );
}
