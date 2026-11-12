import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, ApiRequestError } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { passkeyErrorMessage, passkeysSupported, signupWithPasskey } from '../auth/passkey';
import { Logo } from '../components/Logo';

const USERNAME_RE = /^[a-zA-Z0-9._-]{3,32}$/;

export default function Register() {
  const { setUser } = useAuth();
  const nav = useNavigate();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState<boolean | null>(null);

  useEffect(() => {
    api.auth.config().then((c) => setOpen(c.registrationOpen)).catch(() => setOpen(true));
  }, []);

  function validateUser(): string | null {
    return USERNAME_RE.test(username) ? null : '3 à 32 caractères : lettres, chiffres, point, tiret ou underscore.';
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    const errs: Record<string, string> = {};
    const u = validateUser();
    if (u) errs.username = u;
    if (password.length < 10) errs.password = 'Au moins 10 caractères.';
    if (password !== confirm) errs.confirm = 'Les mots de passe ne correspondent pas.';
    setErrors(errs);
    setError(null);
    if (Object.keys(errs).length) return;
    setBusy(true);
    try {
      setUser(await api.auth.register(username, password));
      nav('/', { replace: true });
    } catch (err) {
      if (err instanceof ApiRequestError) {
        setError(err.message);
        if (err.fields) setErrors(err.fields);
      } else setError('Inscription impossible.');
      setBusy(false);
    }
  }

  async function withPasskey() {
    const u = validateUser();
    setErrors(u ? { username: u } : {});
    setError(null);
    if (u) return;
    setBusy(true);
    try {
      setUser(await signupWithPasskey(username));
      nav('/', { replace: true });
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
        <h1>Créer un compte</h1>
        {open === false ? (
          <div className="alert-box err" role="alert">Les inscriptions sont fermées sur cette instance.</div>
        ) : (
          <>
            {error && <div className="alert-box err" role="alert">{error}</div>}
            <form onSubmit={submit} noValidate>
              <div className="field">
                <label htmlFor="username">Identifiant</label>
                <input id="username" type="text" autoComplete="username" autoCapitalize="none" spellCheck={false} value={username} onChange={(e) => setUsername(e.target.value)} aria-invalid={!!errors.username} aria-describedby={errors.username ? 'username-err' : undefined} />
                {errors.username && <span id="username-err" className="error">{errors.username}</span>}
              </div>
              <div className="field">
                <label htmlFor="password">Mot de passe</label>
                <input id="password" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} aria-invalid={!!errors.password} aria-describedby="password-hint" />
                <span id="password-hint" className={errors.password ? 'error' : 'hint'}>{errors.password ?? '10 caractères minimum.'}</span>
              </div>
              <div className="field">
                <label htmlFor="confirm">Confirmer le mot de passe</label>
                <input id="confirm" type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} aria-invalid={!!errors.confirm} aria-describedby={errors.confirm ? 'confirm-err' : undefined} />
                {errors.confirm && <span id="confirm-err" className="error">{errors.confirm}</span>}
              </div>
              <button type="submit" className="btn btn-primary" style={{ width: '100%' }} disabled={busy}>Créer mon compte</button>
            </form>
            {passkeysSupported() && (
              <>
                <div className="divider">ou</div>
                <button type="button" className="btn" style={{ width: '100%' }} onClick={withPasskey} disabled={busy}>Créer un compte avec une passkey</button>
                <p className="hint muted" style={{ fontSize: '.85rem', marginTop: 8 }}>Sans mot de passe : saisissez seulement l’identifiant ci-dessus.</p>
              </>
            )}
          </>
        )}
        <p style={{ marginTop: 20, marginBottom: 0 }}>Déjà inscrit ? <Link to="/login">Se connecter</Link></p>
      </div>
    </main>
  );
}
