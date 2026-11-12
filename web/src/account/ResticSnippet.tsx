import { useState } from 'react';

/** Encart « Brancher restic » : snippet pré-rempli avec l’URL du site. */
export function ResticSnippet({ token }: { token?: string | null }) {
  const [strategy, setStrategy] = useState('');
  const [host, setHost] = useState('');
  const url = typeof window !== 'undefined' ? window.location.origin : 'https://backup.example.com';
  const snippet = [
    `export BACKUPVIIZ_URL=${url}`,
    `export BACKUPVIIZ_TOKEN=${token || 'bvk_…   # jeton créé ci-dessus'}`,
    `export BACKUPVIIZ_STRATEGY=${strategy.trim() || '<id-de-la-stratégie>'}`,
    `export BACKUPVIIZ_HOST=${host.trim() || '<nom-d-hôte-du-nœud>'}`,
    '',
    '# après votre sauvegarde (ou en enveloppe de la commande) :',
    './restic-report.sh -- restic backup /donnees',
  ].join('\n');

  return (
    <section className="card panel" aria-labelledby="rs-title">
      <h2 id="rs-title">Brancher restic</h2>
      <p className="muted">Reportez l’état réel de vos sauvegardes restic. L’identifiant de la stratégie figure dans l’adresse de l’éditeur (<code>/s/…</code>).</p>
      <div className="tok-form">
        <div className="field">
          <label htmlFor="rs-strategy">Identifiant de la stratégie</label>
          <input id="rs-strategy" type="text" value={strategy} onChange={(e) => setStrategy(e.target.value)} autoComplete="off" />
        </div>
        <div className="field">
          <label htmlFor="rs-host">Nom d’hôte du nœud</label>
          <input id="rs-host" type="text" value={host} onChange={(e) => setHost(e.target.value)} autoComplete="off" />
        </div>
      </div>
      <pre className="code-block" tabIndex={0} aria-label="Exemple de configuration restic"><code>{snippet}</code></pre>
      <p className="muted">Script : <code>scripts/restic-report.sh</code> ; guide complet dans <code>docs/RESTIC.md</code>.</p>
    </section>
  );
}
