import { useEffect, useRef, type ReactNode } from 'react';

export interface ConfirmDialogProps {
  open: boolean;
  title: string;
  children?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

/** Dialogue modal basé sur <dialog> natif (focus piégé, Échap, aria-modal gérés par le navigateur). */
export function ConfirmDialog({ open, title, children, confirmLabel = 'Confirmer', cancelLabel = 'Annuler', danger, onConfirm, onCancel }: ConfirmDialogProps) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) {
      if (typeof d.showModal === 'function') d.showModal();
      else d.setAttribute('open', '');
    } else if (!open && d.open) {
      d.close?.();
    }
  }, [open]);

  return (
    <dialog ref={ref} className="dialog" aria-labelledby="dlg-title" onCancel={(e) => { e.preventDefault(); onCancel(); }} onClick={(e) => { if (e.target === ref.current) onCancel(); }}>
      {open && (
        <div className="dialog-body">
          <h2 id="dlg-title">{title}</h2>
          <div className="dialog-content">{children}</div>
          <div className="dialog-actions">
            <button type="button" className="btn" autoFocus onClick={onCancel}>{cancelLabel}</button>
            <button type="button" className={`btn ${danger ? 'btn-danger' : 'btn-primary'}`} onClick={onConfirm}>{confirmLabel}</button>
          </div>
        </div>
      )}
    </dialog>
  );
}
