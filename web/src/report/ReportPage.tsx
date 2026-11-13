import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import type { Alert, BackupNode, NodeStatus, Severity, Strategy } from '@backupviiz/shared';
import { api, ApiRequestError } from '../api/client';
import { ComplianceBadge, ComplianceBar, LOCATION_LABEL, MEDIA_META, SourceReport } from '../editor/panels';
import ReportDiagram from './diagram';
import { buildInventoryCsv, statusLabel } from './csv';
import './report.css';

const fmtDateTime = (iso: string) => new Date(iso).toLocaleString('fr-FR', { dateStyle: 'long', timeStyle: 'short' });
const fmtDay = (s: string) => {
  const d = new Date(/^\d{4}-\d{2}-\d{2}$/.test(s) ? `${s}T12:00:00` : s);
  return Number.isNaN(d.getTime()) ? s : d.toLocaleDateString('fr-FR', { dateStyle: 'medium' });
};
const dash = '—';
const yesNo = (v: boolean | undefined) => (v === undefined ? 'Non renseigné' : v ? 'Oui' : 'Non');

const GROUPS: { severity: Severity; title: string }[] = [
  { severity: 'error', title: 'Erreurs à corriger' },
  { severity: 'warning', title: 'Avertissements' },
  { severity: 'info', title: 'Informations' },
];

function recoFor(a: { id: string; rule: string }): string {
  if (a.id.startsWith('structure:orphan:')) return 'Reliez ce support à une source ou supprimez-le s\'il est inutile.';
  if (a.id.startsWith('structure:schedule:')) return 'Renseignez la fréquence de ce lien (ex. Quotidien 02:00).';
  if (a.id.startsWith('structure:no-outgoing:')) return 'Ajoutez un lien sortant de cette source vers un support de sauvegarde.';
  return RECO[a.rule] ?? 'Corrigez ce point.';
}

const RECO: Record<string, string> = {
  '3': 'Ajoutez une copie supplémentaire (support distinct) pour atteindre 3 copies au total.',
  '2': 'Stockez au moins une copie sur un autre type de support (ex. NAS + cloud).',
  '1': 'Conservez au moins une copie hors site (cloud, site distant) pour survivre à un sinistre local.',
  structure: 'Corrigez ce point dans le diagramme (liens, fréquences, doublons).',
  immutable: 'Activez une copie immuable (WORM, air-gap) pour résister aux rançongiciels.',
  encryption: 'Chiffrez ce support et ses données, surtout s\'il est hors site.',
  restore: 'Effectuez un test de restauration, puis renseignez sa date dans la fiche du nœud.',
  freshness: 'Vérifiez le job de sauvegarde (planification, accès, espace disque) et relancez-le.',
};

function tokenize(nodes: BackupNode[], ids: string[]) {
  const byId = new Map(nodes.map((n) => [n.id, n.label]));
  return ids.map((i) => byId.get(i) ?? i).join(', ');
}

function realBackup(st: NodeStatus | undefined): string {
  if (!st) return dash;
  const last = st.lastSuccessAt ? fmtDateTime(st.lastSuccessAt) : 'jamais';
  return st.lastStatus === 'ok' ? last : `Échec (dernier succès : ${last})`;
}

function csvDownload(strategy: Strategy) {
  const blob = new Blob([buildInventoryCsv(strategy.nodes, strategy.statuses ?? {})], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${(strategy.name.replace(/[^\w.-]+/g, '_').slice(0, 60) || 'strategie')}-inventaire.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export default function ReportPage() {
  const { id = '' } = useParams();
  const [strategy, setStrategy] = useState<Strategy | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [generatedAt] = useState(() => new Date().toISOString());

  useEffect(() => {
    let live = true;
    setStrategy(null);
    setError(null);
    api.strategies
      .get(id)
      .then((s) => live && setStrategy(s))
      .catch((e) => live && setError(e instanceof ApiRequestError ? e.message : 'Impossible de charger le rapport.'));
    return () => {
      live = false;
    };
  }, [id]);

  useEffect(() => {
    if (strategy) document.title = `Rapport — ${strategy.name}`;
  }, [strategy]);

  const nodeName = useMemo(() => new Map((strategy?.nodes ?? []).map((n) => [n.id, n.label])), [strategy]);

  if (error) {
    return (
      <main className="rp rp-page" id="main">
        <p role="alert" className="rp-error">{error}</p>
        <p><Link to={`/s/${encodeURIComponent(id)}`}>Retour à l'éditeur</Link></p>
      </main>
    );
  }
  if (!strategy) {
    return (
      <main className="rp rp-page" id="main" aria-busy="true">
        <p role="status">Chargement du rapport…</p>
      </main>
    );
  }

  const { evaluation } = strategy;
  const statuses = strategy.statuses ?? {};
  const errorCount = evaluation.alerts.filter((a) => a.severity === 'error').length;
  const warningCount = evaluation.alerts.filter((a) => a.severity === 'warning').length;
  const nodes = strategy.nodes;

  return (
    <main className="rp rp-page" id="main">
      <div className="rp-toolbar no-print">
        <Link to={`/s/${encodeURIComponent(strategy.id)}`} className="rp-btn rp-btn--ghost">← Retour à l'éditeur</Link>
        <span className="rp-spacer" />
        <button type="button" className="rp-btn" onClick={() => csvDownload(strategy)}>Exporter l'inventaire (CSV)</button>
        <button type="button" className="rp-btn rp-btn--primary" onClick={() => window.print()}>Imprimer / Enregistrer en PDF</button>
      </div>

      <header className="rp-header">
        <p className="rp-eyebrow">Rapport de stratégie de sauvegarde</p>
        <h1>{strategy.name}</h1>
        {strategy.description ? <p className="rp-desc">{strategy.description}</p> : null}
        <div className="rp-meta">
          <ComplianceBadge status={evaluation.status} errorCount={errorCount} warningCount={warningCount} />
          <span>Référentiel : {strategy.evaluation.rule ?? '3-2-1'}</span>
          <span>Généré le {fmtDateTime(generatedAt)}</span>
          <span>Dernière modification : {fmtDateTime(strategy.updatedAt)}</span>
        </div>
      </header>

      <section className="rp-section" aria-labelledby="rp-s-summary">
        <h2 id="rp-s-summary">Synthèse 3-2-1</h2>
        <ComplianceBar evaluation={evaluation} />
        <SourceReport evaluation={evaluation} nodes={nodes} />
      </section>

      <section className="rp-section rp-section--diagram" aria-labelledby="rp-s-diagram">
        <h2 id="rp-s-diagram">Diagramme</h2>
        <ReportDiagram doc={{ nodes, edges: strategy.edges }} statuses={statuses} />
      </section>

      <section className="rp-section rp-break" aria-labelledby="rp-s-inventory">
        <h2 id="rp-s-inventory">Inventaire des nœuds</h2>
        {nodes.length === 0 ? (
          <p className="rp-muted">Aucun nœud.</p>
        ) : (
          <div className="rp-tablewrap">
            <table className="rp-table rp-table--inventory">
              <thead>
                <tr>
                  <th scope="col">Nom</th>
                  <th scope="col">Type</th>
                  <th scope="col">Site</th>
                  <th scope="col">Machine</th>
                  <th scope="col">IP</th>
                  <th scope="col">Données</th>
                  <th scope="col">Fréquence</th>
                  <th scope="col">Chiffrement</th>
                  <th scope="col">Rétention</th>
                  <th scope="col">Test restauration</th>
                  <th scope="col">Dernier backup</th>
                </tr>
              </thead>
              <tbody>
                {nodes.map((n) => (
                  <tr key={n.id}>
                    <th scope="row">
                      {n.label}
                      <span className="rp-sub">{n.kind === 'source' ? 'Source' : 'Support'}{n.immutable ? ' · immuable' : ''}</span>
                    </th>
                    <td>{MEDIA_META[n.mediaType].label}</td>
                    <td>{LOCATION_LABEL[n.location]}</td>
                    <td>{n.hostname || dash}</td>
                    <td>{n.ip || dash}</td>
                    <td>{n.data || dash}</td>
                    <td>{n.frequency || dash}</td>
                    <td>{yesNo(n.encrypted)}</td>
                    <td>{n.retention || dash}</td>
                    <td>{n.lastRestoreTestAt ? fmtDay(n.lastRestoreTestAt) : dash}</td>
                    <td className={statuses[n.id]?.lastStatus === 'failed' ? 'is-ko' : undefined}>
                      {realBackup(statuses[n.id])}
                      {statuses[n.id] ? <span className="rp-sub">{statusLabel(statuses[n.id])}</span> : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="rp-section" aria-labelledby="rp-s-links">
        <h2 id="rp-s-links">Liens de sauvegarde</h2>
        {strategy.edges.length === 0 ? (
          <p className="rp-muted">Aucun lien.</p>
        ) : (
          <table className="rp-table">
            <thead>
              <tr>
                <th scope="col">De</th>
                <th scope="col">Vers</th>
                <th scope="col">Méthode</th>
                <th scope="col">Planification</th>
                <th scope="col">Notes</th>
              </tr>
            </thead>
            <tbody>
              {strategy.edges.map((e) => (
                <tr key={e.id}>
                  <td>{nodeName.get(e.from) ?? e.from}</td>
                  <td>{nodeName.get(e.to) ?? e.to}</td>
                  <td>{e.method || dash}</td>
                  <td>{e.schedule || dash}</td>
                  <td>{e.notes || dash}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="rp-section" aria-labelledby="rp-s-alerts">
        <h2 id="rp-s-alerts">Alertes et recommandations</h2>
        {evaluation.alerts.length === 0 ? (
          <p className="rp-ok">Aucune alerte : la stratégie ne présente pas d'écart détecté.</p>
        ) : (
          GROUPS.map((g) => {
            const list: Alert[] = evaluation.alerts.filter((a) => a.severity === g.severity);
            if (list.length === 0) return null;
            return (
              <div key={g.severity} className="rp-alertgroup">
                <h3 className={`rp-sev rp-sev--${g.severity}`}>{g.title} ({list.length})</h3>
                <ul className="rp-alerts">
                  {list.map((a) => (
                    <li key={a.id} className={`rp-alert rp-alert--${a.severity}`}>
                      <p className="rp-alert__msg">{a.message}</p>
                      {a.nodeIds.length > 0 ? <p className="rp-sub">Concerne : {tokenize(nodes, a.nodeIds)}</p> : null}
                      <p className="rp-alert__reco"><strong>Recommandation :</strong> {recoFor(a)}</p>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })
        )}
      </section>
    </main>
  );
}
