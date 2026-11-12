import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import type { ApiTokenInfo } from '@backupviiz/shared';
import { api, ApiRequestError } from '../api/client';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { Skeleton } from '../components/Skeleton';
import { useToast } from '../components/Toast';
import './account.css';

const fmt = (iso: string | null) => (iso ? new Date(iso).toLocaleString('fr-FR', { dateStyle: 'medium', timeStyle: 'short' }) : 'jamais');

/** Jetons API (ingestion restic) : création, affichage unique, liste, révocation. */
export function ApiTokens({ onSecret }: { onSecret?: (token: string | null) => void } = {}) {
  const { toast } = useToast();
  const [tokens, setTokens] = useState<ApiTokenInfo[] | null>(null);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [secret, setSecret] = useState<{ name: string; token: string } | null>(null);
  const [toRevoke, setToRevoke] = useState<ApiTokenInfo | null>(null);
  const secretRef = useRef<HTMLDivElement>(null);

  const load = useCallback(() => {
    api.tokens.list().then(setTokens).catch(() => setTokens([]));
  }, []);
  useEffect(load, [load]);
  useEffect(() => { if (secret) secretRef.current?.focus(); }, [secret]);

  async function create(e: FormEvent) {
    e.preventDefault();
    const n = name.trim();
    if (!n) return setError('Donnez un nom au jeton (par exemple le nom de la machine).');
    setError(null);
    setBusy(true);
    try {
      const t = await api.tokens.create(n);
      setSecret({ name: t.name, token: t.token });
      onSecret?.(t.token);
      setName('');
      setTokens((l) => [{ id: t.id, name: t.name, createdAt: t.createdAt, lastUsedAt: t.lastUsedAt }, ...(l ?? [])]);
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'Création impossible.');
    } finally {
      setBusy(false);
    }
  }

  async function copy() {
    if (!secret) return;
    try {
      await navigator.clipboard.writeText(secret.token);
      toast('Jeton copié.', { kind: 'success' });
    } catch {
      toast('Copie impossible : sélectionnez le jeton et copiez-le manuellement.', { kind: 'error' });
    }
  }

  async function revoke(t: ApiTokenInfo) {
    setToRevoke(null);
    try {
      await api.tokens.remove(t.id);
      setTokens((l) => l?.filter((x) => x.id !== t.id) ?? l);
      toast('Jeton révoqué.', { kind: 'success' });
    } catch (err) {
      toast(err instanceof ApiRequestError ? err.message : 'Révocation impossible.', { kind: 'error' });
    }
  }

  return (
    <section className="card panel" aria-labelledby="tok-title">
      <h2 id="tok-title">Jetons API</h2>
      <p className="muted">Un jeton permet à une machine (script restic) de remonter l’état de ses sauvegardes, sans accès à votre compte.</p>
      {error && <div className="alert-box err" role="alert">{error}</div>}
      {secret && (
        <div className="alert-box ok" role="status" ref={secretRef} tabIndex={-1}>
          <strong>Jeton « {secret.name} » créé.</strong> Copiez-le maintenant : il ne sera plus affiché.
          <div className="tok-secret">
            <code aria-label="Jeton API">{secret.token}</code>
            <button type="button" className="btn btn-sm" onClick={() => void copy()}>Copier</button>
            <button type="button" className="btn btn-sm" onClick={() => { setSecret(null); onSecret?.(null); }}>J’ai copié le jeton</button>
          </div>
        </div>
      )}
      {tokens === null ? (
        <Skeleton height={48} />
      ) : tokens.length === 0 ? (
        <p className="muted">Aucun jeton.</p>
      ) : (
        <ul className="tok-list">
          {tokens.map((t) => (
            <li key={t.id}>
              <div>
                <strong>{t.name}</strong>
                <span className="muted">Créé le {fmt(t.createdAt)} · dernière utilisation : {fmt(t.lastUsedAt)}</span>
              </div>
              <button type="button" className="btn btn-sm btn-danger" onClick={() => setToRevoke(t)} aria-label={`Révoquer le jeton ${t.name}`}>Révoquer</button>
            </li>
          ))}
        </ul>
      )}
      <form onSubmit={create} className="tok-form">
        <div className="field">
          <label htmlFor="tok-name">Nom du nouveau jeton</label>
          <input id="tok-name" type="text" maxLength={64} value={name} onChange={(e) => setName(e.target.value)} placeholder="ex. nas-salon" autoComplete="off" />
        </div>
        <button type="submit" className="btn btn-primary" disabled={busy}>Créer un jeton</button>
      </form>
      <ConfirmDialog open={!!toRevoke} title="Révoquer ce jeton ?" danger confirmLabel="Révoquer" onCancel={() => setToRevoke(null)} onConfirm={() => toRevoke && void revoke(toRevoke)}>
        <p>« {toRevoke?.name} » ne pourra plus transmettre d’état. Les scripts qui l’utilisent échoueront.</p>
      </ConfirmDialog>
    </section>
  );
}
