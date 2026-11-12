import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api/client';
import { useEditor } from './store';

export type SaveStatus = 'saved' | 'dirty' | 'saving' | 'error';

const DEBOUNCE_MS = 1000;

/** Sauvegarde auto debounced (1 s) de nom + doc. Un seul PUT en vol à la fois. */
export function useAutosave(enabled: boolean) {
  const [status, setStatus] = useState<SaveStatus>('saved');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const savedRev = useRef(0);
  const inFlight = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const mounted = useRef(true);

  const flush = useCallback(async (): Promise<void> => {
    clearTimeout(timer.current);
    if (inFlight.current) return; // le `finally` relancera si besoin
    const s = useEditor.getState();
    if (!s.id || s.rev === savedRev.current) return;
    const rev = s.rev;
    inFlight.current = true;
    if (mounted.current) setStatus('saving');
    try {
      await api.strategies.update(s.id, { name: s.name.trim() || 'Sans titre', doc: s.doc });
      savedRev.current = rev;
      if (mounted.current) {
        setErrorMessage(null);
        setStatus(useEditor.getState().rev === rev ? 'saved' : 'dirty');
      }
    } catch (e) {
      if (mounted.current) {
        setErrorMessage(e instanceof Error ? e.message : 'Erreur inconnue');
        setStatus('error');
      }
      inFlight.current = false;
      return;
    }
    inFlight.current = false;
    if (useEditor.getState().rev !== savedRev.current && mounted.current) {
      timer.current = setTimeout(() => void flush(), DEBOUNCE_MS);
    }
  }, []);

  // Réinitialise le point de référence quand une stratégie est chargée.
  const markLoaded = useCallback(() => {
    savedRev.current = useEditor.getState().rev;
    setStatus('saved');
    setErrorMessage(null);
  }, []);

  useEffect(() => {
    if (!enabled) return;
    const unsub = useEditor.subscribe((s, prev) => {
      if (s.rev === prev.rev || s.rev === savedRev.current) return;
      setStatus((st) => (st === 'saving' ? st : 'dirty'));
      clearTimeout(timer.current);
      timer.current = setTimeout(() => void flush(), DEBOUNCE_MS);
    });
    return unsub;
  }, [enabled, flush]);

  // Flush à la fermeture / mise en arrière-plan + avertissement si non sauvegardé.
  useEffect(() => {
    if (!enabled) return;
    const onHide = () => {
      if (document.visibilityState === 'hidden') void flush();
    };
    const onBefore = (e: BeforeUnloadEvent) => {
      if (useEditor.getState().rev !== savedRev.current) {
        void flush();
        e.preventDefault();
        e.returnValue = '';
      }
    };
    document.addEventListener('visibilitychange', onHide);
    window.addEventListener('beforeunload', onBefore);
    return () => {
      document.removeEventListener('visibilitychange', onHide);
      window.removeEventListener('beforeunload', onBefore);
    };
  }, [enabled, flush]);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      clearTimeout(timer.current);
      void flush(); // enregistre les derniers changements en quittant la page
    };
  }, [flush]);

  return { status, errorMessage, saveNow: flush, markLoaded };
}
