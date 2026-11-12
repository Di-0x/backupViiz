import type { BackupNode, Evaluation } from '@backupviiz/shared';
import { MEDIA_META } from './mediaMeta';
import './panels.css';

export interface SourceReportProps {
  evaluation: Evaluation;
  nodes: BackupNode[];
}

function Check({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span className={`sreport__check ${ok ? 'is-ok' : 'is-ko'}`} role="img" aria-label={`${label} : ${ok ? 'respectée' : 'non respectée'}`}>
      {ok ? '✓' : '✗'}
    </span>
  );
}

export default function SourceReport({ evaluation, nodes }: SourceReportProps) {
  if (evaluation.sources.length === 0) {
    return <p className="sreport__empty">Aucune source à analyser.</p>;
  }
  const byId = new Map(nodes.map((n) => [n.id, n]));
  return (
    <div className="sreport">
      {evaluation.sources.map((s) => {
        const node = byId.get(s.sourceId);
        const name = node?.label ?? s.sourceId;
        return (
          <article key={s.sourceId} className={`sreport__card ${s.compliant ? 'is-ok' : 'is-ko'}`} aria-label={`Source ${name}`}>
            <header className="sreport__head">
              {node ? <span className="sreport__icon">{MEDIA_META[node.mediaType].icon}</span> : null}
              <h4 className="sreport__name">{name}</h4>
              <span className={`sreport__verdict ${s.compliant ? 'is-ok' : 'is-ko'}`}>{s.compliant ? 'Conforme' : 'Non conforme'}</span>
            </header>
            <ul className="sreport__rules">
              <li><Check ok={s.ruleThree} label="Règle 3" /> <span><strong>{s.copies}</strong> copie{s.copies > 1 ? 's' : ''} sur 3 requises</span></li>
              <li>
                <Check ok={s.ruleTwo} label="Règle 2" />{' '}
                <span>
                  <strong>{s.mediaTypes.length}</strong> type{s.mediaTypes.length > 1 ? 's' : ''} de support sur 2 requis
                  {s.mediaTypes.length > 0 ? <span className="sreport__muted"> ({s.mediaTypes.map((m) => MEDIA_META[m].label).join(', ')})</span> : null}
                </span>
              </li>
              <li><Check ok={s.ruleOne} label="Règle 1" /> <span><strong>{s.offsiteCopies}</strong> copie{s.offsiteCopies > 1 ? 's' : ''} hors site sur 1 requise</span></li>
            </ul>
            {s.reachableStorageIds.length > 0 ? (
              <p className="sreport__muted">
                Supports atteints : {s.reachableStorageIds.map((id) => byId.get(id)?.label ?? id).join(', ')}
              </p>
            ) : null}
          </article>
        );
      })}
    </div>
  );
}
