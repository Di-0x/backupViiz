import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ReactFlowProvider } from '@xyflow/react';
import { api } from '../api/client';
import { AlertsPanel, Inspector, SourceReport } from './panels';
import Canvas from './Canvas';
import Palette from './Palette';
import Toolbar from './Toolbar';
import { exportPng, exportSvg } from './exportImage';
import { SOURCE_ITEMS, STORAGE_ITEMS } from './presets';
import { useEditor } from './store';
import { useAutosave } from './useAutosave';
import './editor.css';

type Tab = 'props' | 'alerts' | 'report';
type Load = { state: 'loading' } | { state: 'ready' } | { state: 'error'; status: number; message: string };

const isTyping = (t: EventTarget | null) => {
  const el = t as HTMLElement | null;
  return !!el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName));
};

export default function StrategyEditorPage() {
  const { id } = useParams<{ id: string }>();
  const [load, setLoad] = useState<Load>({ state: 'loading' });
  const [tab, setTab] = useState<Tab>('alerts');
  const [sideOpen, setSideOpen] = useState(false);
  const [attempt, setAttempt] = useState(0);

  const autosave = useAutosave(load.state === 'ready');
  const { markLoaded } = autosave;

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    setLoad({ state: 'loading' });
    api.strategies
      .get(id)
      .then((s) => {
        if (cancelled) return;
        useEditor.getState().load(s);
        markLoaded();
        setLoad({ state: 'ready' });
      })
      .catch((e: { status?: number; message?: string }) => {
        if (!cancelled) setLoad({ state: 'error', status: e.status ?? 0, message: e.message ?? 'Erreur de chargement' });
      });
    return () => {
      cancelled = true;
    };
  }, [id, attempt, markLoaded]);

  useEffect(() => {
    document.title = 'Éditeur — BackupViiz';
  }, []);

  const name = useEditor((s) => s.name);
  const doc = useEditor((s) => s.doc);
  const evaluation = useEditor((s) => s.evaluation);
  const selNodes = useEditor((s) => s.selectedNodeIds);
  const selEdges = useEditor((s) => s.selectedEdgeIds);
  const canUndo = useEditor((s) => s.past.length > 0);
  const canRedo = useEditor((s) => s.future.length > 0);

  // Raccourcis clavier globaux.
  useEffect(() => {
    if (load.state !== 'ready') return;
    const onKey = (e: KeyboardEvent) => {
      const st = useEditor.getState();
      const mod = e.ctrlKey || e.metaKey;
      const k = e.key.toLowerCase();
      if (mod && k === 's') {
        e.preventDefault();
        void autosave.saveNow();
        return;
      }
      if (isTyping(e.target)) return;
      if (mod && k === 'z') (e.preventDefault(), e.shiftKey ? st.redo() : st.undo());
      else if (mod && k === 'y') (e.preventDefault(), st.redo());
      else if (mod && k === 'd') (e.preventDefault(), st.duplicateSelection());
      else if (mod || e.altKey) return;
      else if (k === 'n') (e.preventDefault(), st.addNode(SOURCE_ITEMS[0]!));
      else if (k === 's') (e.preventDefault(), st.addNode(STORAGE_ITEMS[2]!));
      else if (k === 'l') (e.preventDefault(), st.autoLayout());
      else if (k === 'k' && st.selectedNodeIds.length === 2) {
        e.preventDefault();
        const [a, b] = st.selectedNodeIds as [string, string];
        const bn = st.doc.nodes.find((n) => n.id === b);
        if (bn?.kind === 'storage') st.connect(a, b);
        else st.connect(b, a);
      } else if (k === 'escape') st.select([], []);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [load.state, autosave]);

  // Ouvre l'onglet « Propriétés » à la sélection d'un élément unique.
  const single = selNodes.length + selEdges.length === 1;
  useEffect(() => {
    if (single) setTab('props');
  }, [single, selNodes, selEdges]);

  const selectedNode = useMemo(() => (selNodes.length === 1 && !selEdges.length ? doc.nodes.find((n) => n.id === selNodes[0]) : undefined), [doc.nodes, selNodes, selEdges]);
  const selectedEdge = useMemo(() => (selEdges.length === 1 && !selNodes.length ? doc.edges.find((e) => e.id === selEdges[0]) : undefined), [doc.edges, selNodes, selEdges]);

  const st = useEditor.getState;
  const onChangeNode = useCallback((nid: string, patch: Parameters<ReturnType<typeof st>['updateNode']>[1]) => st().updateNode(nid, patch), [st]);
  const onChangeEdge = useCallback((eid: string, patch: Parameters<ReturnType<typeof st>['updateEdge']>[1]) => st().updateEdge(eid, patch), [st]);
  const onDelete = useCallback((kind: 'node' | 'edge', did: string) => (kind === 'node' ? st().deleteMany([did], []) : st().deleteMany([], [did])), [st]);
  const onHoverAlert = useCallback((ids: string[] | null) => st().highlight(ids), [st]);
  const onSelectNodes = useCallback((ids: string[]) => (st().select(ids), st().requestFocus(ids)), [st]);
  const onFocusNode = useCallback((nid: string) => (st().select([nid]), st().requestFocus([nid])), [st]);

  const onExport = useCallback(
    (fmt: 'svg' | 'png') => {
      const s = st();
      if (fmt === 'svg') exportSvg(s.doc, s.name);
      else void exportPng(s.doc, s.name).catch(() => undefined);
    },
    [st],
  );

  const alertCount = evaluation.alerts.filter((a) => a.severity !== 'info').length;

  if (load.state === 'loading') {
    return (
      <div className="bv-editor-state" role="status" aria-busy="true">
        <div className="bv-skel bv-skel--bar" />
        <div className="bv-skel bv-skel--body" />
        <span className="bv-sr-only">Chargement de la stratégie…</span>
      </div>
    );
  }
  if (load.state === 'error') {
    return (
      <div className="bv-editor-state bv-editor-state--msg" role="alert">
        <h1>{load.status === 404 ? 'Stratégie introuvable' : 'Chargement impossible'}</h1>
        <p>{load.status === 404 ? "Elle n'existe pas ou ne vous appartient pas." : load.message}</p>
        <div>
          {load.status !== 404 && (
            <button type="button" className="bv-btn" onClick={() => setAttempt((a) => a + 1)}>
              Réessayer
            </button>
          )}{' '}
          <Link to="/" className="bv-btn">
            Retour à la liste
          </Link>
        </div>
      </div>
    );
  }

  const multi = selNodes.length + selEdges.length > 1;
  return (
    <ReactFlowProvider>
      <div className="bv-editor">
        <Toolbar
          name={name}
          onName={(v) => useEditor.getState().setName(v)}
          status={autosave.status}
          errorMessage={autosave.errorMessage}
          onRetry={() => void autosave.saveNow()}
          canUndo={canUndo}
          canRedo={canRedo}
          onUndo={() => st().undo()}
          onRedo={() => st().redo()}
          onLayout={() => st().autoLayout()}
          onExport={onExport}
          evaluation={evaluation}
          alertCount={alertCount}
          alertsOpen={sideOpen && tab === 'alerts'}
          onToggleAlerts={() => {
            if (tab === 'alerts') setSideOpen((o) => !o);
            else (setTab('alerts'), setSideOpen(true));
          }}
        />
        <div className="bv-editor__body">
          <Palette />
          <main className="bv-editor__canvas" id="main" tabIndex={-1} aria-label="Diagramme de la stratégie">
            <h1 className="sr-only">{name}</h1>
            <Canvas />
            <button type="button" className="bv-side-fab" onClick={() => setSideOpen((o) => !o)} aria-expanded={sideOpen}>
              {sideOpen ? 'Fermer le panneau' : single ? 'Propriétés' : `Alertes (${alertCount})`}
            </button>
          </main>
          <aside className={`bv-side${sideOpen ? ' is-open' : ''}`} aria-label="Panneaux d'analyse">
            <h2 className="sr-only">Analyse de la stratégie</h2>
            <div role="tablist" className="bv-tabs" aria-label="Panneaux">
              {(
                [
                  ['props', 'Propriétés'],
                  ['alerts', 'Alertes'],
                  ['report', 'Rapport'],
                ] as [Tab, string][]
              ).map(([t, label]) => (
                <button key={t} role="tab" type="button" id={`tab-${t}`} aria-selected={tab === t} aria-controls={`panel-${t}`} onClick={() => setTab(t)}>
                  {label}
                </button>
              ))}
              <button type="button" className="bv-side__close" onClick={() => setSideOpen(false)} aria-label="Fermer le panneau">
                ×
              </button>
            </div>
            <div role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`} className="bv-side__panel">
              {tab === 'props' &&
                (selectedNode || selectedEdge ? (
                  <Inspector
                    node={selectedNode}
                    edge={selectedEdge}
                    nodes={doc.nodes}
                    onChangeNode={onChangeNode}
                    onChangeEdge={onChangeEdge}
                    onDelete={onDelete}
                  />
                ) : multi ? (
                  <div className="bv-hint">
                    <p>
                      {selNodes.length} élément{selNodes.length > 1 ? 's' : ''} sélectionné{selNodes.length > 1 ? 's' : ''}.
                    </p>
                    <button type="button" className="bv-btn" onClick={() => st().duplicateSelection()}>
                      Dupliquer
                    </button>{' '}
                    <button type="button" className="bv-btn bv-btn--danger" onClick={() => st().deleteSelection()}>
                      Supprimer
                    </button>
                  </div>
                ) : (
                  <p className="bv-hint">Sélectionnez un support, une source ou un lien pour modifier ses propriétés.</p>
                ))}
              {tab === 'alerts' && (
                <AlertsPanel evaluation={evaluation} onHoverAlert={onHoverAlert} onSelectNodes={onSelectNodes} onFocusNode={onFocusNode} />
              )}
              {tab === 'report' && <SourceReport evaluation={evaluation} nodes={doc.nodes} />}
            </div>
          </aside>
        </div>
      </div>
    </ReactFlowProvider>
  );
}
