import type { Alert, Evaluation, Severity } from '@backupviiz/shared';
import './panels.css';

export interface AlertsPanelProps {
  evaluation: Evaluation;
  onHoverAlert: (nodeIds: string[] | null) => void;
  onSelectNodes: (ids: string[]) => void;
  onFocusNode?: (id: string) => void;
}

const GROUPS: { severity: Severity; title: string }[] = [
  { severity: 'error', title: 'Erreurs' },
  { severity: 'warning', title: 'Avertissements' },
  { severity: 'info', title: 'Informations' },
];

const SEV_LABEL: Record<Severity, string> = { error: 'Erreur', warning: 'Avertissement', info: 'Information' };

function SevIcon({ severity }: { severity: Severity }) {
  const p = { width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, 'aria-hidden': true, focusable: false as const };
  if (severity === 'error') return <svg {...p}><circle cx="12" cy="12" r="9" /><path d="M12 7v6M12 16.5h.01" /></svg>;
  if (severity === 'warning') return <svg {...p}><path d="M12 4l9 16H3L12 4zM12 10v4M12 17h.01" /></svg>;
  return <svg {...p}><circle cx="12" cy="12" r="9" /><path d="M12 11v5M12 8h.01" /></svg>;
}

export default function AlertsPanel({ evaluation, onHoverAlert, onSelectNodes, onFocusNode }: AlertsPanelProps) {
  const { alerts, status } = evaluation;
  const actionable = alerts.filter((a) => a.severity !== 'info');
  const showOk = status === 'compliant' && actionable.length === 0;

  const activate = (a: Alert) => {
    onSelectNodes(a.nodeIds);
    const first = a.nodeIds[0];
    if (first !== undefined) onFocusNode?.(first);
  };

  return (
    <section className="alerts" aria-label="Alertes de conformité">
      <div className="alerts__live" role="status" aria-live="polite">
        {status === 'empty' ? (
          <p className="alerts__state alerts__state--empty">Ajoutez une source de données pour évaluer la stratégie.</p>
        ) : showOk ? (
          <p className="alerts__state alerts__state--ok">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>
            Conforme 3-2-1 ✓
          </p>
        ) : (
          <p className="alerts__summary">
            {alerts.filter((a) => a.severity === 'error').length} erreur(s), {alerts.filter((a) => a.severity === 'warning').length} avertissement(s)
          </p>
        )}
      </div>
      {GROUPS.map(({ severity, title }) => {
        const list = alerts.filter((a) => a.severity === severity);
        if (list.length === 0) return null;
        return (
          <div key={severity} className="alerts__group">
            <h3 className={`alerts__title alerts__title--${severity}`}>
              {title} <span className="alerts__count">{list.length}</span>
            </h3>
            <ul className="alerts__list">
              {list.map((a) => (
                <li key={a.id} className="alerts__li">
                  <button
                    type="button"
                    className={`alerts__item alerts__item--${severity}`}
                    onClick={() => activate(a)}
                    onMouseEnter={() => onHoverAlert(a.nodeIds)}
                    onMouseLeave={() => onHoverAlert(null)}
                    onFocus={() => onHoverAlert(a.nodeIds)}
                    onBlur={() => onHoverAlert(null)}
                  >
                    <SevIcon severity={severity} />
                    <span className="alerts__msg">
                      <span className="sr-only">{SEV_LABEL[severity]} : </span>
                      {a.message}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        );
      })}
    </section>
  );
}
