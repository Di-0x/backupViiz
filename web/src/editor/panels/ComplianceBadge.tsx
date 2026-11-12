import type { ComplianceStatus } from '@backupviiz/shared';
import './panels.css';

export interface ComplianceBadgeProps {
  status: ComplianceStatus;
  errorCount: number;
  warningCount: number;
  compact?: boolean;
}

const LABEL: Record<ComplianceStatus, string> = {
  compliant: 'Conforme 3-2-1',
  warning: 'À surveiller',
  violation: 'Non conforme',
  empty: 'Aucune source',
};

const plural = (n: number, one: string, many: string) => `${n} ${n > 1 ? many : one}`;

function Icon({ status }: { status: ComplianceStatus }) {
  const p = { width: 14, height: 14, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2.4, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, 'aria-hidden': true, focusable: false as const };
  switch (status) {
    case 'compliant':
      return <svg {...p}><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>;
    case 'warning':
      return <svg {...p}><path d="M12 4l9 16H3L12 4zM12 10v4M12 17h.01" /></svg>;
    case 'violation':
      return <svg {...p}><circle cx="12" cy="12" r="9" /><path d="M9 9l6 6M15 9l-6 6" /></svg>;
    default:
      return <svg {...p}><circle cx="12" cy="12" r="9" /><path d="M8 12h8" /></svg>;
  }
}

export default function ComplianceBadge({ status, errorCount, warningCount, compact }: ComplianceBadgeProps) {
  const parts: string[] = [];
  if (errorCount > 0) parts.push(plural(errorCount, 'erreur', 'erreurs'));
  if (warningCount > 0) parts.push(plural(warningCount, 'avertissement', 'avertissements'));
  const detail = parts.join(', ');
  const full = detail ? `${LABEL[status]} — ${detail}` : LABEL[status];
  const counts = errorCount + warningCount;
  return (
    <span className={`cbadge cbadge--${status}${compact ? ' cbadge--compact' : ''}`} title={full} aria-label={full} role="img">
      <Icon status={status} />
      {compact ? (
        counts > 0 ? <span className="cbadge__count" aria-hidden="true">{counts}</span> : null
      ) : (
        <span className="cbadge__text" aria-hidden="true">
          {LABEL[status]}
          {detail ? <span className="cbadge__detail"> · {detail}</span> : null}
        </span>
      )}
    </span>
  );
}
