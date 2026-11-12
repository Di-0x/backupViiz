import { useCallback, useEffect, useId, useRef, useState } from 'react';
import type { Strategy, StrategyDoc, StrategyVersionSummary } from '@backupviiz/shared';
import { api } from '../../api/client';
import MiniDiagram from './MiniDiagram';
import { absoluteTime, describeDiff, diffDocs, relativeTime } from './diff';
import './history.css';

interface Props { strategyId: string; open: boolean; onClose: () => void; onRestored: (s: Strategy) => void }
interface Detail { id: string; createdAt: string; name: string; doc: StrategyDoc }

const errMsg = (e: unknown) => (e instanceof Error && e.message ? e.message : 'Erreur inattendue.');
const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export default function VersionsDrawer({ strategyId, open, onClose, onRestored }: Props) {
  const titleId = useId();
  const ref = useRef<HTMLDivElement>(null);
  const returnTo = useRef<Element | null>(null);
  const [versions, setVersions] = useState<StrategyVersionSummary[] | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [current, setCurrent] = useState<StrategyDoc | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [restoreError, setRestoreError] = useState<string | null>(null);

  const load = useCallback(() => {
    setVersions(null); setListError(null);
    api.strategies.versions(strategyId).then(setVersions, (e) => setListError(errMsg(e)));
    api.strategies.get(strategyId).then((s) => setCurrent({ nodes: s.nodes, edges: s.edges }), () => setCurrent(null));
  }, [strategyId]);

  useEffect(() => {
    if (!open) return;
    setSelected(null); setDetail(null); setConfirming(false); setRestoreError(null);
    load();
  }, [open, load]);

  // Focus : entrée / restitution
  useEffect(() => {
    if (!open) return;
    returnTo.current = document.activeElement;
    ref.current?.querySelector<HTMLElement>(FOCUSABLE)?.focus();
    return () => { (returnTo.current as HTMLElement | null)?.focus?.(); };
  }, [open]);

  const select = (vid: string) => {
    setSelected(vid); setDetail(null); setDetailError(null); setConfirming(false); setRestoreError(null); setDetailLoading(true);
    api.strategies.version(strategyId, vid).then(
      (d) => { setSelected((cur) => { if (cur === vid) { setDetail(d); setDetailLoading(false); } return cur; }); },
      (e) => { setSelected((cur) => { if (cur === vid) { setDetailError(errMsg(e)); setDetailLoading(false); } return cur; }); },
    );
  };

  const restore = async () => {
    if (!selected) return;
    setRestoring(true); setRestoreError(null);
    try {
      const s = await api.strategies.restoreVersion(strategyId, selected);
      onRestored(s);
      onClose();
    } catch (e) {
      setRestoreError(errMsg(e));
    } finally {
      setRestoring(false);
    }
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') { e.stopPropagation(); onClose(); return; }
    if (e.key !== 'Tab' || !ref.current) return;
    const els = Array.from(ref.current.querySelectorAll<HTMLElement>(FOCUSABLE));
    if (!els.length) return;
    const first = els[0]!, last = els[els.length - 1]!;
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    else if (!ref.current.contains(document.activeElement)) { e.preventDefault(); first.focus(); }
  };

  if (!open) return null;

  return (
    <div className="vh-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div ref={ref} className="vh-drawer" role="dialog" aria-modal="true" aria-labelledby={titleId} onKeyDown={onKeyDown}>
        <div className="vh-head">
          <h2 id={titleId}>Historique des versions</h2>
          <button type="button" className="vh-btn" onClick={onClose}>Fermer</button>
        </div>
        <div className="vh-body">
          {listError && (
            <div role="alert">
              <p className="vh-error">Impossible de charger l’historique : {listError}</p>
              <button type="button" className="vh-btn" onClick={load}>Réessayer</button>
            </div>
          )}
          {!listError && versions === null && <p className="vh-muted" role="status">Chargement des versions…</p>}
          {versions && versions.length === 0 && (
            <p className="vh-muted">Aucune version enregistrée pour l’instant. Les versions sont créées automatiquement quand vous modifiez la stratégie.</p>
          )}
          {versions && versions.length > 0 && (
            <ul className="vh-list" aria-label="Versions">
              {versions.map((v) => (
                <li key={v.id}>
                  <button type="button" className="vh-item" aria-current={selected === v.id ? 'true' : undefined} onClick={() => select(v.id)}>
                    <span className="vh-when">{relativeTime(v.createdAt)} <span className="vh-meta">· {absoluteTime(v.createdAt)}</span></span>
                    <span className="vh-meta">{v.nodeCount} nœud{v.nodeCount > 1 ? 's' : ''}, {v.edgeCount} lien{v.edgeCount > 1 ? 's' : ''}</span>
                    {v.reason === 'restore' && <span className="vh-tag">Avant une restauration</span>}
                  </button>
                </li>
              ))}
            </ul>
          )}

          {selected && (
            <section className="vh-preview" aria-label="Aperçu de la version" aria-live="polite">
              {detailLoading && <p className="vh-muted" role="status">Chargement de l’aperçu…</p>}
              {detailError && (
                <div role="alert">
                  <p className="vh-error">Impossible de charger cette version : {detailError}</p>
                  <button type="button" className="vh-btn" onClick={() => select(selected)}>Réessayer</button>
                </div>
              )}
              {detail && (
                <>
                  <h3>{detail.name || 'Version'} — {absoluteTime(detail.createdAt)}</h3>
                  <MiniDiagram doc={detail.doc} label={`Aperçu : ${detail.doc.nodes.length} nœuds, ${detail.doc.edges.length} liens`} />
                  <p className="vh-diff">
                    {current ? `Par rapport à l’état actuel : ${describeDiff(diffDocs(current, detail.doc))}` : `${detail.doc.nodes.length} nœuds, ${detail.doc.edges.length} liens`}
                  </p>
                  {!confirming ? (
                    <div className="vh-actions">
                      <button type="button" className="vh-btn vh-btn-primary" onClick={() => setConfirming(true)}>Restaurer cette version</button>
                    </div>
                  ) : (
                    <div className="vh-confirm" role="group" aria-label="Confirmation de restauration">
                      <p style={{ margin: 0 }}>Restaurer cette version ? L’état actuel sera d’abord enregistré dans l’historique, vous pourrez donc revenir en arrière.</p>
                      <div className="vh-actions">
                        <button type="button" className="vh-btn" autoFocus onClick={() => setConfirming(false)} disabled={restoring}>Annuler</button>
                        <button type="button" className="vh-btn vh-btn-danger" onClick={restore} disabled={restoring}>{restoring ? 'Restauration…' : 'Confirmer la restauration'}</button>
                      </div>
                    </div>
                  )}
                  {restoreError && <p className="vh-error" role="alert">Échec de la restauration : {restoreError}</p>}
                </>
              )}
            </section>
          )}
        </div>
      </div>
    </div>
  );
}
