import { memo } from 'react';
import { Handle, Position } from '@xyflow/react';
import type { Node, NodeProps } from '@xyflow/react';
import type { BackupNode, Severity } from '@backupviiz/shared';
import { LOCATION_LABEL, MEDIA_META } from './panels';

export interface BackupNodeData extends Record<string, unknown> {
  node: BackupNode;
  /** Numéro de copie (1 = source, 2 = 1er saut…). */
  copy?: number;
  /** Pire sévérité des alertes (hors info) touchant ce nœud. */
  severity?: Severity;
  highlighted?: boolean;
}
export type BackupFlowNode = Node<BackupNodeData, 'source' | 'storage'>;

function NodeCard({ data, selected, kind }: { data: BackupNodeData; selected?: boolean; kind: 'source' | 'storage' }) {
  const n = data.node;
  const meta = MEDIA_META[n.mediaType];
  const cls = [
    'bv-node',
    `bv-node--${kind}`,
    selected ? 'is-selected' : '',
    data.severity === 'error' ? 'is-error' : data.severity === 'warning' ? 'is-warning' : '',
    data.highlighted ? 'is-hl' : '',
  ]
    .filter(Boolean)
    .join(' ');
  return (
    <div className={cls}>
      {kind === 'storage' && <Handle type="target" position={Position.Left} className="bv-handle" title="Entrée du lien" />}
      <div className="bv-node__icon" aria-hidden="true">
        {meta.icon}
      </div>
      <div className="bv-node__body">
        <div className="bv-node__kind">{kind === 'source' ? 'Source' : 'Support'}</div>
        <div className="bv-node__label" title={n.label}>
          {n.label}
        </div>
        <div className="bv-node__meta">
          <span>{meta.label}</span>
          <span className={`bv-pill bv-pill--${n.location}`}>{LOCATION_LABEL[n.location]}</span>
          {n.immutable && <span className="bv-pill bv-pill--immutable">Immuable</span>}
          {n.encrypted === true && <span className="bv-pill bv-pill--enc">🔒 Chiffré</span>}
          {n.encrypted === false && <span className="bv-pill bv-pill--noenc">Non chiffré</span>}
        </div>
        {(n.hostname || n.ip) && (
          <div className="bv-node__host" title={[n.hostname, n.ip].filter(Boolean).join(' · ')}>
            {[n.hostname, n.ip].filter(Boolean).join(' · ')}
          </div>
        )}
      </div>
      {data.copy != null && (
        <span className="bv-node__copy" title={`Copie n° ${data.copy}`}>
          {data.copy}
        </span>
      )}
      {data.severity && <span className="bv-sr-only">{data.severity === 'error' ? 'Non conforme' : 'Avertissement'}</span>}
      <Handle type="source" position={Position.Right} className="bv-handle" title="Sortie du lien (glisser vers un support)" />
    </div>
  );
}

export const SourceNode = memo(function SourceNode(p: NodeProps<BackupFlowNode>) {
  return <NodeCard data={p.data} selected={p.selected} kind="source" />;
});
export const StorageNode = memo(function StorageNode(p: NodeProps<BackupFlowNode>) {
  return <NodeCard data={p.data} selected={p.selected} kind="storage" />;
});
