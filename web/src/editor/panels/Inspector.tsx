import { useId } from 'react';
import { LOCATIONS, MEDIA_TYPES } from '@backupviiz/shared';
import type { BackupEdge, BackupNode, Location, MediaType } from '@backupviiz/shared';
import { LOCATION_LABEL, MEDIA_META, METHOD_SUGGESTIONS, SCHEDULE_SUGGESTIONS } from './mediaMeta';
import './panels.css';

export interface InspectorProps {
  node?: BackupNode;
  edge?: BackupEdge;
  nodes: BackupNode[];
  onChangeNode: (id: string, patch: Partial<BackupNode>) => void;
  onChangeEdge: (id: string, patch: Partial<BackupEdge>) => void;
  onDelete: (kind: 'node' | 'edge', id: string) => void;
}

export default function Inspector({ node, edge, nodes, onChangeNode, onChangeEdge, onDelete }: InspectorProps) {
  const uid = useId();
  const id = (s: string) => `${uid}-${s}`;

  if (node) {
    const isSource = node.kind === 'source';
    return (
      <form className="inspector" aria-label={isSource ? 'Propriétés de la source' : 'Propriétés du support'} onSubmit={(e) => e.preventDefault()}>
        <h3 className="inspector__title">
          <span className="inspector__icon">{MEDIA_META[node.mediaType].icon}</span>
          {isSource ? 'Source de données' : 'Support de sauvegarde'}
        </h3>
        <div className="inspector__field">
          <label htmlFor={id('label')}>Nom</label>
          <input id={id('label')} type="text" maxLength={80} required value={node.label} onChange={(e) => onChangeNode(node.id, { label: e.target.value })} />
        </div>
        <div className="inspector__field">
          <label htmlFor={id('media')}>Type de support</label>
          <select id={id('media')} value={node.mediaType} onChange={(e) => onChangeNode(node.id, { mediaType: e.target.value as MediaType })}>
            {MEDIA_TYPES.map((m) => <option key={m} value={m}>{MEDIA_META[m].label}</option>)}
          </select>
        </div>
        <div className="inspector__field">
          <label htmlFor={id('loc')}>Emplacement</label>
          <select id={id('loc')} value={node.location} onChange={(e) => onChangeNode(node.id, { location: e.target.value as Location })}>
            {LOCATIONS.map((l) => <option key={l} value={l}>{LOCATION_LABEL[l]}</option>)}
          </select>
        </div>
        <div className="inspector__field">
          <label htmlFor={id('host')}>Nom de machine</label>
          <input id={id('host')} type="text" maxLength={100} placeholder="ex : srv-compta-01" autoComplete="off" value={node.hostname ?? ''} onChange={(e) => onChangeNode(node.id, { hostname: e.target.value })} />
        </div>
        <div className="inspector__field">
          <label htmlFor={id('ip')}>Adresse IP</label>
          <input id={id('ip')} type="text" inputMode="decimal" maxLength={64} placeholder="ex : 192.168.1.10" autoComplete="off" value={node.ip ?? ''} onChange={(e) => onChangeNode(node.id, { ip: e.target.value })} />
        </div>
        <div className="inspector__field">
          <label htmlFor={id('data')}>{isSource ? 'Données à sauvegarder' : 'Données sauvegardées'}</label>
          <textarea id={id('data')} rows={2} maxLength={500} placeholder="ex : bases SQL, dossier /srv/partages" value={node.data ?? ''} onChange={(e) => onChangeNode(node.id, { data: e.target.value })} />
        </div>
        <div className="inspector__field">
          <label htmlFor={id('freq')}>Fréquence de sauvegarde</label>
          <input id={id('freq')} type="text" list={id('freq-list')} maxLength={100} placeholder="ex : Quotidien 02:00" value={node.frequency ?? ''} onChange={(e) => onChangeNode(node.id, { frequency: e.target.value })} />
          <datalist id={id('freq-list')}>{SCHEDULE_SUGGESTIONS.map((s) => <option key={s} value={s} />)}</datalist>
        </div>
        <div className="inspector__field">
          <label htmlFor={id('enc')}>Chiffrement</label>
          <select id={id('enc')} value={node.encrypted === undefined ? '' : node.encrypted ? 'yes' : 'no'} onChange={(e) => onChangeNode(node.id, { encrypted: e.target.value === '' ? undefined : e.target.value === 'yes' })}>
            <option value="">Non renseigné</option>
            <option value="yes">Chiffré</option>
            <option value="no">Non chiffré</option>
          </select>
        </div>
        <div className="inspector__field inspector__field--check">
          <input id={id('imm')} type="checkbox" checked={!!node.immutable} onChange={(e) => onChangeNode(node.id, { immutable: e.target.checked })} />
          <label htmlFor={id('imm')}>Copie immuable / WORM / air-gap</label>
        </div>
        <div className="inspector__field">
          <label htmlFor={id('notes')}>Notes</label>
          <textarea id={id('notes')} rows={3} maxLength={500} value={node.notes ?? ''} onChange={(e) => onChangeNode(node.id, { notes: e.target.value })} />
        </div>
        <button type="button" className="inspector__delete" onClick={() => onDelete('node', node.id)}>
          Supprimer {isSource ? 'la source' : 'le support'}
        </button>
      </form>
    );
  }

  if (edge) {
    const name = (nid: string) => nodes.find((n) => n.id === nid)?.label ?? 'inconnu';
    return (
      <form className="inspector" aria-label="Propriétés du lien" onSubmit={(e) => e.preventDefault()}>
        <h3 className="inspector__title">Lien de sauvegarde</h3>
        <p className="inspector__route">
          <strong>{name(edge.from)}</strong> <span aria-label="vers">→</span> <strong>{name(edge.to)}</strong>
        </p>
        <div className="inspector__field">
          <label htmlFor={id('method')}>Méthode</label>
          <input id={id('method')} type="text" list={id('methods')} placeholder="ex. rsync, restic…" value={edge.method ?? ''} onChange={(e) => onChangeEdge(edge.id, { method: e.target.value })} />
          <datalist id={id('methods')}>{METHOD_SUGGESTIONS.map((m) => <option key={m} value={m} />)}</datalist>
        </div>
        <div className="inspector__field">
          <label htmlFor={id('sched')}>Fréquence</label>
          <input id={id('sched')} type="text" list={id('scheds')} placeholder="ex. Quotidien 02:00" value={edge.schedule ?? ''} onChange={(e) => onChangeEdge(edge.id, { schedule: e.target.value })} />
          <datalist id={id('scheds')}>{SCHEDULE_SUGGESTIONS.map((m) => <option key={m} value={m} />)}</datalist>
        </div>
        <div className="inspector__field">
          <label htmlFor={id('enotes')}>Notes</label>
          <textarea id={id('enotes')} rows={3} maxLength={500} value={edge.notes ?? ''} onChange={(e) => onChangeEdge(edge.id, { notes: e.target.value })} />
        </div>
        <button type="button" className="inspector__delete" onClick={() => onDelete('edge', edge.id)}>Supprimer le lien</button>
      </form>
    );
  }

  return (
    <p className="inspector__empty">Sélectionnez un support ou un lien dans le diagramme pour modifier ses propriétés.</p>
  );
}
