import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

export interface ToastOptions {
  kind?: 'info' | 'success' | 'error';
  duration?: number;
  action?: { label: string; onClick: () => void };
  /** Appelé quand le toast disparaît sans action (timeout ou fermeture). */
  onExpire?: () => void;
}
interface ToastItem extends ToastOptions {
  id: number;
  message: string;
}
interface ToastApi {
  toast: (message: string, opts?: ToastOptions) => number;
  dismiss: (id: number) => void;
}

const Ctx = createContext<ToastApi | null>(null);

export function useToast(): ToastApi {
  const v = useContext(Ctx);
  if (!v) throw new Error('useToast doit être utilisé dans <ToastProvider>');
  return v;
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const seq = useRef(0);
  const timers = useRef(new Map<number, number>());
  const itemsRef = useRef<ToastItem[]>([]);
  itemsRef.current = items;

  const remove = useCallback((id: number, expired: boolean) => {
    const t = timers.current.get(id);
    if (t) window.clearTimeout(t);
    timers.current.delete(id);
    const item = itemsRef.current.find((i) => i.id === id);
    if (!item) return;
    setItems((l) => l.filter((i) => i.id !== id));
    if (expired) item.onExpire?.();
  }, []);

  const toast = useCallback(
    (message: string, opts: ToastOptions = {}) => {
      const id = ++seq.current;
      const item: ToastItem = { id, message, kind: 'info', duration: opts.action ? 7000 : 4500, ...opts };
      itemsRef.current = [...itemsRef.current, item];
      setItems(itemsRef.current);
      timers.current.set(id, window.setTimeout(() => remove(id, true), item.duration));
      return id;
    },
    [remove],
  );
  const dismiss = useCallback((id: number) => remove(id, false), [remove]);

  useEffect(() => {
    const map = timers.current;
    return () => map.forEach((t) => window.clearTimeout(t));
  }, []);

  const api = useMemo(() => ({ toast, dismiss }), [toast, dismiss]);

  return (
    <Ctx.Provider value={api}>
      {children}
      <div className="toasts" role="region" aria-label="Notifications">
        {items.map((t) => (
          <div key={t.id} className={`toast toast-${t.kind}`} role={t.kind === 'error' ? 'alert' : 'status'}>
            <span className="toast-msg">{t.message}</span>
            {t.action && (
              <button
                type="button"
                className="btn btn-sm"
                onClick={() => {
                  t.action?.onClick();
                  remove(t.id, false);
                }}
              >
                {t.action.label}
              </button>
            )}
            <button type="button" className="btn btn-sm btn-ghost" aria-label="Fermer la notification" onClick={() => remove(t.id, true)}>
              ×
            </button>
          </div>
        ))}
      </div>
    </Ctx.Provider>
  );
}
