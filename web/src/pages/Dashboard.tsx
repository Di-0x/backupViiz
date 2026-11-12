import { useCallback, useEffect, useRef, useState, type ChangeEvent } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { instantiateTemplate, TEMPLATES, type StrategyDoc, type StrategySummary } from '@backupviiz/shared';
import { api, ApiRequestError } from '../api/client';
import { addPasskey, passkeyErrorMessage } from '../auth/passkey';
import { AppHeader } from '../components/AppHeader';
import ComplianceBadge from '../editor/panels/ComplianceBadge';
import { CardSkeletons } from '../components/Skeleton';
import { useToast } from '../components/Toast';

const fmtDate = (iso: string) => new Date(iso).toLocaleString('fr-FR', { dateStyle: 'medium', timeStyle: 'short' });
const plural = (n: number, s: string) => `${n} ${s}${n > 1 ? 's' : ''}`;
const errMsg = (e: unknown, fallback: string) => (e instanceof ApiRequestError ? e.message : fallback);

function download(filename: string, data: unknown) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export default function Dashboard() {
  const nav = useNavigate();
  const loc = useLocation();
  const { toast } = useToast();
  const [items, setItems] = useState<StrategySummary[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [picker, setPicker] = useState(false);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const [suggest, setSuggest] = useState((loc.state as { suggestPasskey?: boolean } | null)?.suggestPasskey === true);

  const load = useCallback(() => {
    setLoadError(null);
    api.strategies.list().then(setItems).catch((e) => setLoadError(errMsg(e, 'Impossible de charger les stratégies.')));
  }, []);
  useEffect(load, [load]);

  async function createFrom(index: number) {
    const t = TEMPLATES[index];
    if (!t || busy) return;
    setBusy(true);
    try {
      const doc: StrategyDoc = instantiateTemplate(t);
      const s = await api.strategies.create({ name: index === 0 ? 'Nouvelle stratégie' : t.name, description: t.description, doc });
      nav(`/s/${s.id}`);
    } catch (e) {
      toast(errMsg(e, 'Création impossible.'), { kind: 'error' });
      setBusy(false);
    }
  }

  async function duplicate(s: StrategySummary) {
    try {
      await api.strategies.duplicate(s.id);
      toast(`« ${s.name} » dupliquée.`, { kind: 'success' });
      load();
    } catch (e) {
      toast(errMsg(e, 'Duplication impossible.'), { kind: 'error' });
    }
  }

  async function exportOne(s: StrategySummary) {
    try {
      const data = await api.strategies.export(s.id);
      download(`${s.name.replace(/[^\w.-]+/g, '_') || 'strategie'}.backupviiz.json`, data);
    } catch (e) {
      toast(errMsg(e, 'Export impossible.'), { kind: 'error' });
    }
  }

  /** Suppression optimiste : retrait immédiat, suppression réelle à l'expiration du toast « Annuler ». */
  function remove(s: StrategySummary) {
    const index = items?.findIndex((x) => x.id === s.id) ?? 0;
    setItems((l) => l?.filter((x) => x.id !== s.id) ?? l);
    const restore = () =>
      setItems((l) => {
        if (!l || l.some((x) => x.id === s.id)) return l;
        const copy = [...l];
        copy.splice(Math.min(index, copy.length), 0, s);
        return copy;
      });
    toast(`« ${s.name} » supprimée.`, {
      action: { label: 'Annuler', onClick: restore },
      onExpire: () => {
        api.strategies.remove(s.id).catch((e) => {
          restore();
          toast(errMsg(e, 'Suppression impossible.'), { kind: 'error' });
        });
      },
    });
  }

  async function onImport(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      if (file.size > 1_000_000) throw new Error('size');
      const json = JSON.parse(await file.text()) as { name?: unknown; description?: unknown; doc?: StrategyDoc; nodes?: unknown; edges?: unknown };
      const doc = json.doc ?? (Array.isArray(json.nodes) ? (json as unknown as StrategyDoc) : undefined);
      if (!doc || !Array.isArray(doc.nodes) || !Array.isArray(doc.edges)) throw new Error('format');
      const s = await api.strategies.import({
        name: typeof json.name === 'string' ? json.name.slice(0, 100) : file.name.replace(/\.json$/i, '').slice(0, 100),
        description: typeof json.description === 'string' ? json.description : undefined,
        doc: { nodes: doc.nodes, edges: doc.edges },
      });
      toast(`« ${s.name} » importée.`, { kind: 'success' });
      load();
    } catch (err) {
      toast(err instanceof ApiRequestError ? err.message : 'Fichier invalide : un export JSON BackupViiz est attendu (1 Mo max).', { kind: 'error' });
    }
  }

  async function createPasskey() {
    setSuggest(false);
    try {
      await addPasskey(`Passkey du ${new Date().toLocaleDateString('fr-FR')}`);
      toast('Passkey créée : vous pourrez l’utiliser à la prochaine connexion.', { kind: 'success' });
    } catch (e) {
      const m = passkeyErrorMessage(e);
      if (m) toast(m, { kind: 'error' });
    }
  }

  return (
    <>
      <AppHeader />
      <main className="container" id="main">
        {suggest && (
          <div className="alert-box ok suggest" role="status">
            <span>Connectez-vous plus vite la prochaine fois avec une passkey.</span>
            <span>
              <button type="button" className="btn btn-sm" onClick={createPasskey}>Créer une passkey</button>{' '}
              <button type="button" className="btn btn-sm btn-ghost" onClick={() => setSuggest(false)}>Plus tard</button>
            </span>
          </div>
        )}
        <div className="page-head">
          <h1>Mes stratégies de backup</h1>
          <div className="page-actions">
            <input ref={fileRef} type="file" accept="application/json,.json" hidden onChange={onImport} aria-label="Importer un fichier JSON" />
            <button type="button" className="btn" onClick={() => fileRef.current?.click()}>Importer (JSON)</button>
            <button type="button" className="btn btn-primary" aria-expanded={picker} aria-controls="tpl-picker" onClick={() => setPicker((v) => !v)}>
              Nouvelle stratégie
            </button>
          </div>
        </div>

        {picker && (
          <section id="tpl-picker" className="card panel" aria-label="Choisir un modèle">
            <h2>Partir de…</h2>
            <div className="grid">
              {TEMPLATES.map((t, i) => (
                <button key={t.id} type="button" className="tpl" disabled={busy} onClick={() => void createFrom(i)}>
                  <strong>{t.name}</strong>
                  <span className="muted">{t.description}</span>
                </button>
              ))}
            </div>
          </section>
        )}

        {loadError ? (
          <div className="alert-box err" role="alert">
            {loadError} <button type="button" className="btn btn-sm" onClick={load}>Réessayer</button>
          </div>
        ) : items === null ? (
          <CardSkeletons />
        ) : items.length === 0 ? (
          <div className="card panel empty">
            <h2>Aucune stratégie pour l’instant</h2>
            <p className="muted">Créez votre première stratégie 3-2-1 à partir d’un modèle, ou importez un export JSON.</p>
            <button type="button" className="btn btn-primary" onClick={() => setPicker(true)}>Nouvelle stratégie</button>
          </div>
        ) : (
          <ul className="grid" aria-label="Stratégies">
            {items.map((s) => (
              <li key={s.id} className="card strategy-card">
                <h2><Link to={`/s/${s.id}`}>{s.name}</Link></h2>
                {s.description && <p className="muted desc">{s.description}</p>}
                <ComplianceBadge status={s.status} errorCount={s.errorCount} warningCount={s.warningCount} />
                <p className="muted meta">{plural(s.nodeCount, 'nœud')} · {plural(s.edgeCount, 'lien')}<br />Modifiée le {fmtDate(s.updatedAt)}</p>
                <div className="card-actions">
                  <Link to={`/s/${s.id}`} className="btn btn-sm btn-primary">Ouvrir</Link>
                  <button type="button" className="btn btn-sm" onClick={() => void duplicate(s)} aria-label={`Dupliquer ${s.name}`}>Dupliquer</button>
                  <button type="button" className="btn btn-sm" onClick={() => void exportOne(s)} aria-label={`Exporter ${s.name}`}>Exporter</button>
                  <button type="button" className="btn btn-sm btn-danger" onClick={() => remove(s)} aria-label={`Supprimer ${s.name}`}>Supprimer</button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </main>
    </>
  );
}
