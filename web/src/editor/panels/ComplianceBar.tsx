import type { Evaluation } from '@backupviiz/shared';
import './panels.css';

export interface ComplianceBarProps {
  evaluation: Evaluation;
}

interface Pill {
  key: string;
  digit: string;
  ok: boolean;
  tip: string;
}

export default function ComplianceBar({ evaluation }: ComplianceBarProps) {
  const src = evaluation.sources;
  const empty = src.length === 0;
  const n = src.length;
  const c3 = src.filter((s) => s.ruleThree).length;
  const c2 = src.filter((s) => s.ruleTwo).length;
  const c1 = src.filter((s) => s.ruleOne).length;
  const mk = (key: string, digit: string, count: number, what: string): Pill => ({
    key,
    digit,
    ok: !empty && count === n,
    tip: empty
      ? `${what} : aucune source`
      : `${what} : ${count} source${count > 1 ? 's' : ''} sur ${n} conforme${count > 1 ? 's' : ''}`,
  });
  const pills: Pill[] = [
    mk('3', '3', c3, 'Règle des 3 copies'),
    mk('2', '2', c2, 'Règle des 2 types de supports'),
    mk('1', '1', c1, 'Règle de 1 copie hors site'),
  ];
  return (
    <div className="cbar" role="group" aria-label="Conformité 3-2-1">
      {pills.map((p, i) => (
        <span key={p.key} className="cbar__item">
          {i > 0 ? <span className="cbar__sep" aria-hidden="true">·</span> : null}
          <span
            className={`cbar__pill ${empty ? 'is-empty' : p.ok ? 'is-ok' : 'is-ko'}`}
            title={p.tip}
            aria-label={`${p.tip} — ${empty ? 'non évaluée' : p.ok ? 'respectée' : 'non respectée'}`}
            role="img"
          >
            {p.digit}
          </span>
        </span>
      ))}
    </div>
  );
}
