import { Link } from 'react-router-dom';
import type { Evaluation } from '@backupviiz/shared';
import { ComplianceBar } from './panels';
import type { SaveStatus } from './useAutosave';

export interface ToolbarProps {
  name: string;
  onName: (v: string) => void;
  status: SaveStatus;
  errorMessage: string | null;
  onRetry: () => void;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  onLayout: () => void;
  onExport: (fmt: 'svg' | 'png') => void;
  evaluation: Evaluation;
  alertCount: number;
  alertsOpen: boolean;
  onToggleAlerts: () => void;
}

const I = ({ d }: { d: string }) => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d={d} />
  </svg>
);

export default function Toolbar(p: ToolbarProps) {
  const mac = typeof navigator !== 'undefined' && /Mac/i.test(navigator.platform);
  const mod = mac ? '⌘' : 'Ctrl+';
  return (
    <header className="bv-toolbar">
      <Link to="/" className="bv-btn bv-btn--icon" aria-label="Retour à la liste des stratégies" title="Retour à la liste">
        <I d="M15 18l-6-6 6-6" />
      </Link>
      <input
        className="bv-name"
        value={p.name}
        onChange={(e) => p.onName(e.target.value)}
        onBlur={() => !p.name.trim() && p.onName('Sans titre')}
        aria-label="Nom de la stratégie"
        maxLength={100}
        placeholder="Nom de la stratégie"
      />
      <div className={`bv-save bv-save--${p.status}`} role="status" aria-live="polite">
        {p.status === 'saved' && 'Enregistré'}
        {p.status === 'dirty' && 'Modifications en attente…'}
        {p.status === 'saving' && 'Enregistrement…'}
        {p.status === 'error' && (
          <>
            <span title={p.errorMessage ?? undefined}>Erreur</span> —{' '}
            <button type="button" className="bv-link" onClick={p.onRetry}>
              réessayer
            </button>
          </>
        )}
      </div>
      <div className="bv-toolbar__group" role="group" aria-label="Édition">
        <button type="button" className="bv-btn bv-btn--icon" onClick={p.onUndo} disabled={!p.canUndo} aria-label="Annuler" title={`Annuler (${mod}Z)`}>
          <I d="M9 14L4 9l5-5M4 9h10a6 6 0 010 12h-3" />
        </button>
        <button type="button" className="bv-btn bv-btn--icon" onClick={p.onRedo} disabled={!p.canRedo} aria-label="Rétablir" title={`Rétablir (${mod}Y)`}>
          <I d="M15 14l5-5-5-5M20 9H10a6 6 0 000 12h3" />
        </button>
        <button type="button" className="bv-btn bv-btn--icon" onClick={p.onLayout} aria-label="Réorganiser automatiquement" title="Réorganiser (L)">
          <I d="M3 5h6v4H3zM15 3h6v4h-6zM15 15h6v4h-6zM9 7h3v10h3M12 9h3" />
        </button>
        <details className="bv-export">
          <summary className="bv-btn" title="Exporter le diagramme">
            Exporter
          </summary>
          <div className="bv-export__menu">
            <button type="button" onClick={() => p.onExport('svg')}>
              Image SVG
            </button>
            <button type="button" onClick={() => p.onExport('png')}>
              Image PNG
            </button>
          </div>
        </details>
      </div>
      <div className="bv-toolbar__compliance">
        <ComplianceBar evaluation={p.evaluation} />
      </div>
      <button
        type="button"
        className={`bv-btn bv-btn--alerts${p.alertCount ? ' has-alerts' : ''}`}
        aria-pressed={p.alertsOpen}
        onClick={p.onToggleAlerts}
        title="Afficher les alertes"
      >
        Alertes
        <span className="bv-count" aria-label={`${p.alertCount} alerte${p.alertCount > 1 ? 's' : ''}`}>
          {p.alertCount}
        </span>
      </button>
    </header>
  );
}
