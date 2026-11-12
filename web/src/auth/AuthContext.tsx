import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import type { User } from '@backupviiz/shared';
import { api, ApiRequestError, setUnauthorizedHandler } from '../api/client';
import { Skeleton } from '../components/Skeleton';

interface AuthState {
  /** undefined = chargement initial, null = non connecté. */
  user: User | null | undefined;
  setUser: (u: User | null) => void;
  refresh: () => Promise<User | null>;
  logout: () => Promise<void>;
}

const Ctx = createContext<AuthState | null>(null);

export function useAuth(): AuthState & { user: User | null | undefined } {
  const v = useContext(Ctx);
  if (!v) throw new Error('useAuth doit être utilisé dans <AuthProvider>');
  return v;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null | undefined>(undefined);

  const refresh = useCallback(async () => {
    try {
      const u = await api.auth.me();
      setUser(u);
      return u;
    } catch (e) {
      if (!(e instanceof ApiRequestError) || e.status === 401) setUser(null);
      else setUser((prev) => prev ?? null);
      return null;
    }
  }, []);

  useEffect(() => {
    void refresh();
    setUnauthorizedHandler(() => setUser(null));
    return () => setUnauthorizedHandler(null);
  }, [refresh]);

  const logout = useCallback(async () => {
    try {
      await api.auth.logout();
    } finally {
      setUser(null);
    }
  }, []);

  const value = useMemo(() => ({ user, setUser, refresh, logout }), [user, refresh, logout]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/** Garde de route : redirige vers /login si non authentifié. */
export function RequireAuth({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const loc = useLocation();
  if (user === undefined) {
    return (
      <div className="container" role="status" aria-label="Chargement">
        <Skeleton height={32} width="40%" />
      </div>
    );
  }
  if (user === null) return <Navigate to="/login" replace state={{ from: loc.pathname + loc.search }} />;
  return <>{children}</>;
}

/** Pages publiques (login/register) : redirige vers l'accueil si déjà connecté. */
export function RedirectIfAuthed({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  if (user) return <Navigate to="/" replace />;
  return <>{children}</>;
}
