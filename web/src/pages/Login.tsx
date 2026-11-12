import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { api, ApiRequestError } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { conditionalUiAvailable, loginWithPasskey, passkeyErrorMessage, passkeysSupported } from '../auth/passkey';
import { Logo } from '../components/Logo';

export default function Login() {
  const { setUser } = useAuth();
  const nav = useNavigate();
  const loc = useLocation();
  const from = (loc.state as { from?: string } | null)?.from ?? '/';
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [registrationOpen, setRegistrationOpen] = useState(false);
  const canPasskey = passkeysSupported();
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    api.auth.config().then((c) => mounted.current && setRegistrationOpen(c.registrationOpen)).catch(() => {});
    // Conditional UI : propose les passkeys dans l'autocomplétion du champ identifiant.
    void conditionalUiAvailable().then(async (ok) => {
      if (!ok || !mounted.current) return;
      try {
        const u = await loginWithPasskey({ conditional: true });
        if (mounted.current) {
          setUser(u);
          nav(from, { replace: true });
        }
      } catch {
        /* annulé ou interrompu : on ignore */
      }
    });
    return () => {
      mounted.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const u = await api.auth.login(username.trim(), password);
      setUser(u);
      // Suggestion discrète de passkey après connexion par mot de passe.
      nav(from, { replace: true, state: passkeysSupported() && u.passkeyCount === 0 ? { suggestPasskey: true } : undefined });
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'Connexion impossible.');
      setBusy(false);
    }
  }

  async function passkey() {
    setError(null);
    setBusy(true);
    try {
      const u = await loginWithPasskey({ username: username.trim() || undefined });
      setUser(u);
      nav(from, { replace: true });
    } catch (err) {
      const m = passkeyErrorMessage(err);
      if (m) setError(m);
      setBusy(false);
    }
  }

  return (
    <main className="auth-page" id="main">
      <div className="card auth-card">
        <div className="brand"><Logo size={36} /> BackupViiz</div>
        <h1>Connexion</h1>
        {error && <div className="alert-box err" role="alert">{error}</div>}
        <form onSubmit={submit}>
          <div className="field">
            <label htmlFor="username">Identifiant</label>
            <input id="username" name="username" type="text" autoComplete="username webauthn" autoCapitalize="none" spellCheck={false} required value={username} onChange={(e) => setUsername(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="password">Mot de passe</label>
            <input id="password" name="password" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
          </div>
          <button type="submit" className="btn btn-primary" style={{ width: '100%' }} disabled={busy}>Se connecter</button>
        </form>
        {canPasskey && (
          <>
            <div className="divider">ou</div>
            <button type="button" className="btn" style={{ width: '100%' }} onClick={passkey} disabled={busy}>Se connecter avec une passkey</button>
          </>
        )}
        {registrationOpen && <p style={{ marginTop: 20, marginBottom: 0 }}>Pas encore de compte ? <Link to="/register">Créer un compte</Link></p>}
      </div>
    </main>
  );
}
