import type { ComplianceStatus } from '@backupviiz/shared';

// Fallback local temporaire : à remplacer par `editor/panels/ComplianceBadge` (propriété editor-panels).
const LABEL: Record<ComplianceStatus, string> = {
  compliant: 'Conforme 3-2-1',
  warning: 'Avertissements',
  violation: 'Non conforme',
  empty: 'Vide',
};
const ICON: Record<ComplianceStatus, string> = { compliant: '✓', warning: '!', violation: '✕', empty: '–' };

export interface ComplianceBadgeProps {
  status: ComplianceStatus;
  errorCount: number;
  warningCount: number;
  compact?: boolean;
}

export function ComplianceBadge({ status, errorCount, warningCount, compact }: ComplianceBadgeProps) {
  const detail = status === 'violation' ? `${errorCount} erreur${errorCount > 1 ? 's' : ''}` : status === 'warning' ? `${warningCount} avertissement${warningCount > 1 ? 's' : ''}` : '';
  return (
    <span className={`cbadge cbadge-${status}`}>
      <span aria-hidden="true">{ICON[status]}</span>
      <span>{compact ? LABEL[status] : detail ? `${LABEL[status]} · ${detail}` : LABEL[status]}</span>
    </span>
  );
}
