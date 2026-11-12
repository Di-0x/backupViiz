import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import type { PasskeyInfo } from '@backupviiz/shared';
import { api, ApiRequestError } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { addPasskey, passkeyErrorMessage, passkeysSupported } from '../auth/passkey';
import { AppHeader } from '../components/AppHeader';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { Skeleton } from '../components/Skeleton';
import { useToast } from '../components/Toast';

const fmt = (iso: string | null) => (iso ? new Date(iso).toLocaleString('fr-FR', { dateStyle: 'medium', timeStyle: 'short' }) : 'jamais');

export default function Account() {
  const { user, refresh, logout } = useAuth();
  const { toast } = useToast();
  const nav = useNavigate();
  const [passkeys, setPasskeys] = useState<PasskeyInfo[] | null>(null);
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [pwError, setPwError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [toDelete, setToDelete] = useState<PasskeyInfo | null>(null);

  const load = useCallback(() => {
    api.passkey.list().then(setPasskeys).catch(() => setPasskeys([]));
  }, []);
  useEffect(load, [load]);

  async function changePassword(e: FormEvent) {
    e.preventDefault();
    setPwError(null);
    if (next.length < 10) return setPwError('Le nouveau mot de passe doit contenir au moins 10 caractères.');
    setBusy(true);
    try {
      await api.auth.setPassword({ currentPassword: user?.hasPassword ? current : undefined, newPassword: next });
      setCurrent('');
      setNext('');
      toast('Mot de passe enregistré. Les autres sessions ont été déconnectées.', { kind: 'success' });
      await refresh();
    } catch (err) {
      setPwError(err instanceof ApiRequestError ? err.message : 'Échec de la mise à jour.');
    } finally {
      setBusy(false);
    }
  }

  async function add() {
    setBusy(true);
    try {
      const name = `Passkey du ${new Date().toLocaleDateString('fr-FR')}`;
      await addPasskey(name);
      toast('Passkey ajoutée.', { kind: 'success' });
      load();
      await refresh();
    } catch (err) {
      const m = passkeyErrorMessage(err);
      if (m) toast(m, { kind: 'error' });
    } finally {
      setBusy(false);
    }
  }

  async function rename(p: PasskeyInfo) {
    const name = editName.trim();
    setEditing(null);
    if (!name || name === p.name) return;
    setPasskeys((l) => l?.map((x) => (x.id === p.id ? { ...x, name } : x)) ?? l);
    try {
      await api.passkey.rename(p.id, name);
    } catch (err) {
      toast(err instanceof ApiRequestError ? err.message : 'Renommage impossible.', { kind: 'error' });
      load();
    }
  }

  async function remove(p: PasskeyInfo) {
    setToDelete(null);
    try {
      await api.passkey.remove(p.id);
      setPasskeys((l) => l?.filter((x) => x.id !== p.id) ?? l);
      toast('Passkey supprimée.', { kind: 'success' });
      await refresh();
    } catch (err) {
      toast(err instanceof ApiRequestError ? err.message : 'Suppression impossible.', { kind: 'error' });
    }
  }

  return (
    <>
      <AppHeader />
      <main className="container" id="main">
        <h1>Mon compte</h1>
        <p className="muted">Connecté en tant que <strong>{user?.username}</strong>.</p>

        <section className="card panel" aria-labelledby="pk-title">
          <h2 id="pk-title">Passkeys</h2>
          {!passkeysSupported() && <p className="muted">Votre navigateur ne prend pas en charge les passkeys.</p>}
          {passkeys === null ? (
            <Skeleton height={48} />
          ) : passkeys.length === 0 ? (
            <p className="muted">Aucune passkey enregistrée. Une passkey permet de se connecter sans mot de passe, avec l’empreinte, le visage ou le code de l’appareil.</p>
          ) : (
            <ul className="pk-list">
              {passkeys.map((p) => (
                <li key={p.id}>
                  <div className="pk-info">
                    {editing === p.id ? (
                      <form onSubmit={(e) => { e.preventDefault(); void rename(p); }} className="pk-edit">
                        <label className="sr-only" htmlFor={`pk-${p.id}`}>Nom de la passkey</label>
                        <input id={`pk-${p.id}`} type="text" autoFocus maxLength={64} value={editName} onChange={(e) => setEditName(e.target.value)} onKeyDown={(e) => e.key === 'Escape' && setEditing(null)} />
                        <button type="submit" className="btn btn-sm btn-primary">OK</button>
                      </form>
                    ) : (
                      <strong>{p.name}</strong>
                    )}
                    <span className="muted">Ajoutée le {fmt(p.createdAt)} · dernière utilisation : {fmt(p.lastUsedAt)}</span>
                  </div>
                  <div className="pk-actions">
                    <button type="button" className="btn btn-sm" onClick={() => { setEditing(p.id); setEditName(p.name); }}>Renommer</button>
                    <button type="button" className="btn btn-sm btn-danger" onClick={() => setToDelete(p)}>Supprimer</button>
                  </div>
                </li>
              ))}
            </ul>
          )}
          {passkeysSupported() && <button type="button" className="btn btn-primary" onClick={add} disabled={busy}>Ajouter une passkey</button>}
        </section>

        <section className="card panel" aria-labelledby="pw-title">
          <h2 id="pw-title">{user?.hasPassword ? 'Changer le mot de passe' : 'Définir un mot de passe'}</h2>
          {pwError && <div className="alert-box err" role="alert">{pwError}</div>}
          <form onSubmit={changePassword} style={{ maxWidth: 420 }}>
            {user?.hasPassword && (
              <div className="field">
                <label htmlFor="cur">Mot de passe actuel</label>
                <input id="cur" type="password" autoComplete="current-password" required value={current} onChange={(e) => setCurrent(e.target.value)} />
              </div>
            )}
            <div className="field">
              <label htmlFor="new">Nouveau mot de passe</label>
              <input id="new" type="password" autoComplete="new-password" required value={next} onChange={(e) => setNext(e.target.value)} aria-describedby="new-hint" />
              <span id="new-hint" className="hint">10 caractères minimum. Les autres sessions seront déconnectées.</span>
            </div>
            <button type="submit" className="btn btn-primary" disabled={busy}>Enregistrer</button>
          </form>
        </section>

        <section className="card panel" aria-labelledby="out-title">
          <h2 id="out-title">Session</h2>
          <button type="button" className="btn" onClick={async () => { await logout(); nav('/login', { replace: true }); }}>Se déconnecter</button>
        </section>
      </main>
      <ConfirmDialog open={!!toDelete} title="Supprimer cette passkey ?" danger confirmLabel="Supprimer" onCancel={() => setToDelete(null)} onConfirm={() => toDelete && void remove(toDelete)}>
        <p>« {toDelete?.name} » ne pourra plus être utilisée pour se connecter.</p>
      </ConfirmDialog>
    </>
  );
}
