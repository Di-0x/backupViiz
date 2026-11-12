import { useEffect, useId, useRef } from 'react';
import './help.css';

export const HELP_FLAG_KEY = 'backupviiz.help321.seen';

/** Vrai si l'aide n'a jamais été vue (localStorage indisponible : on ne l'ouvre pas en boucle → false). */
export function shouldAutoOpenHelp(): boolean {
  try {
    return localStorage.getItem(HELP_FLAG_KEY) !== '1';
  } catch {
    return false;
  }
}

export function markHelpSeen(): void {
  try {
    localStorage.setItem(HELP_FLAG_KEY, '1');
  } catch {
    /* stockage indisponible : ignoré */
  }
}

export interface HelpDialogProps {
  open: boolean;
  onClose: () => void;
}

function Diagram({ titleId }: { titleId: string }) {
  const box = (x: number, y: number, w: number, label: string, fill: string) => (
    <g>
      <rect x={x} y={y} width={w} height="44" rx="8" fill={fill} stroke="currentColor" strokeWidth="1.5" />
      <text x={x + w / 2} y={y + 27} textAnchor="middle" fontSize="13" fill="currentColor">{label}</text>
    </g>
  );
  return (
    <svg className="help__svg" viewBox="0 0 520 190" role="img" aria-labelledby={titleId}>
      <title id={titleId}>Schéma : une donnée d'origine, une copie sur un autre support sur site, une copie hors site</title>
      <defs>
        <marker id="help-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto">
          <path d="M0 0L10 5L0 10z" fill="currentColor" />
        </marker>
      </defs>
      {box(10, 73, 130, 'Données (copie 1)', 'var(--surface-2, #f3f4f6)')}
      {box(195, 20, 150, 'Disque / NAS (copie 2)', 'var(--surface-2, #f3f4f6)')}
      {box(195, 126, 150, 'Cloud (copie 3)', 'var(--ok-bg, #dcfce7)')}
      <path d="M140 90 L193 50" stroke="currentColor" strokeWidth="1.5" fill="none" markerEnd="url(#help-arrow)" />
      <path d="M140 105 L193 146" stroke="currentColor" strokeWidth="1.5" fill="none" markerEnd="url(#help-arrow)" />
      <text x="365" y="46" fontSize="13" fill="currentColor">2 supports différents</text>
      <text x="365" y="152" fontSize="13" fill="currentColor">1 hors site</text>
      <text x="10" y="180" fontSize="13" fill="currentColor">3 copies au total</text>
    </svg>
  );
}

export default function HelpDialog({ open, onClose }: HelpDialogProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const svgId = useId();

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) {
      if (typeof d.showModal === 'function') d.showModal();
      else d.setAttribute('open', '');
    } else if (!open && d.open) {
      if (typeof d.close === 'function') d.close();
      else d.removeAttribute('open');
    }
  }, [open]);

  return (
    <dialog
      ref={ref}
      className="help"
      aria-labelledby={titleId}
      onClose={() => {
        markHelpSeen();
        if (open) onClose();
      }}
      onCancel={() => markHelpSeen()}
      onClick={(e) => {
        if (e.target === ref.current) ref.current?.close();
      }}
    >
      <div className="help__card">
        <h2 id={titleId} className="help__title">La règle de sauvegarde 3-2-1</h2>
        <Diagram titleId={svgId} />
        <ul className="help__list">
          <li><strong>3 copies</strong> de vos données : l'original et au moins deux sauvegardes.</li>
          <li><strong>2 supports différents</strong> : par exemple un disque et un NAS, pour qu'une même panne ne détruise pas tout.</li>
          <li><strong>1 copie hors site</strong> : dans le cloud ou dans un autre lieu, pour survivre à un incendie ou un vol.</li>
        </ul>
        <p className="help__next"><strong>Et après ?</strong> Testez la restauration. Une sauvegarde jamais restaurée n'est qu'une hypothèse : renseignez la date du dernier test dans les propriétés de chaque source.</p>
        <p className="help__tip">Ajoutez vos sources et supports depuis la palette, reliez-les, puis consultez l'onglet Alertes : il propose des corrections en un clic.</p>
        <div className="help__actions">
          <button type="button" className="bv-btn" autoFocus onClick={() => ref.current?.close()}>
            J'ai compris
          </button>
        </div>
      </div>
    </dialog>
  );
}
