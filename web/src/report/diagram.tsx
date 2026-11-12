import type { BackupNode, NodeStatus, StrategyDoc } from '@backupviiz/shared';
import { LOCATION_LABEL, MEDIA_META } from '../editor/panels';

const W = 230;
const H = 112;
const PAD = 28;

const trunc = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

function statusMark(st: NodeStatus | undefined): { text: string; color: string } | null {
  if (!st) return null;
  return st.lastStatus === 'ok' ? { text: 'Backup OK', color: '#17703a' } : { text: 'Échec du dernier backup', color: '#b42318' };
}

/** Rendu SVG statique et autonome (couleurs fixes, thème clair) du diagramme de stratégie. */
export default function ReportDiagram({ doc, statuses = {} }: { doc: StrategyDoc; statuses?: Record<string, NodeStatus> }) {
  if (doc.nodes.length === 0) return <p className="rp-muted">Diagramme vide.</p>;
  const minX = Math.min(...doc.nodes.map((n) => n.position.x)) - PAD;
  const minY = Math.min(...doc.nodes.map((n) => n.position.y)) - PAD;
  const maxX = Math.max(...doc.nodes.map((n) => n.position.x)) + W + PAD;
  const maxY = Math.max(...doc.nodes.map((n) => n.position.y)) + H + PAD;
  const width = maxX - minX;
  const height = maxY - minY;
  const byId = new Map<string, BackupNode>(doc.nodes.map((n) => [n.id, n]));
  return (
    <svg
      className="rp-diagram"
      xmlns="http://www.w3.org/2000/svg"
      viewBox={`${minX} ${minY} ${width} ${height}`}
      width="100%"
      style={{ maxWidth: width, maxHeight: '150mm' }}
      role="img"
      aria-label={`Diagramme de la stratégie : ${doc.nodes.length} nœuds, ${doc.edges.length} liens`}
      fontFamily="system-ui,Segoe UI,Arial,sans-serif"
    >
      <defs>
        <marker id="rp-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
          <path d="M0 0L10 5L0 10z" fill="#566070" />
        </marker>
      </defs>
      <rect x={minX} y={minY} width={width} height={height} fill="#ffffff" />
      {doc.edges.map((e) => {
        const a = byId.get(e.from);
        const b = byId.get(e.to);
        if (!a || !b) return null;
        const x1 = a.position.x + W;
        const y1 = a.position.y + H / 2;
        const x2 = b.position.x;
        const y2 = b.position.y + H / 2;
        const dx = Math.max(40, Math.abs(x2 - x1) / 2);
        const label = [e.method, e.schedule].filter(Boolean).join(' · ');
        return (
          <g key={e.id}>
            <path d={`M${x1} ${y1}C${x1 + dx} ${y1} ${x2 - dx} ${y2} ${x2} ${y2}`} fill="none" stroke="#566070" strokeWidth={2} markerEnd="url(#rp-arrow)" />
            {label ? (
              <text x={(x1 + x2) / 2} y={(y1 + y2) / 2 - 6} fontSize={11} textAnchor="middle" fill="#566070" stroke="#ffffff" strokeWidth={4} paintOrder="stroke">
                {trunc(label, 40)}
              </text>
            ) : null}
          </g>
        );
      })}
      {doc.nodes.map((n) => {
        const { x, y } = n.position;
        const src = n.kind === 'source';
        const st = statusMark(statuses[n.id]);
        const machine = [n.hostname, n.ip].filter(Boolean).join(' · ');
        return (
          <g key={n.id}>
            <rect x={x} y={y} width={W} height={H} rx={10} fill={src ? '#eef3ff' : '#f5f6f8'} stroke={src ? '#2557d6' : '#566070'} strokeWidth={2} />
            <text x={x + 12} y={y + 24} fontSize={14} fontWeight={600} fill="#14181f">{trunc(n.label, 28)}</text>
            <text x={x + 12} y={y + 42} fontSize={11} fill="#566070">
              {MEDIA_META[n.mediaType].label} · {LOCATION_LABEL[n.location]}
            </text>
            <text x={x + 12} y={y + 59} fontSize={11} fill="#14181f">{machine ? trunc(machine, 36) : 'Machine non renseignée'}</text>
            <text x={x + 12} y={y + 76} fontSize={10} fill={n.encrypted ? '#17703a' : n.encrypted === false ? '#b42318' : '#566070'} fontWeight={600}>
              {n.encrypted ? 'Chiffré' : n.encrypted === false ? 'Non chiffré' : 'Chiffrement non renseigné'}
              {n.immutable ? ' · Immuable' : ''}
            </text>
            <text x={x + 12} y={y + 93} fontSize={10} fill="#566070">
              {src ? 'SOURCE' : 'SUPPORT'}
              {n.retention ? ` · ${trunc(n.retention, 30)}` : ''}
            </text>
            {st ? (
              <text x={x + 12} y={y + 107} fontSize={9.5} fontWeight={600} fill={st.color}>{st.text}</text>
            ) : null}
          </g>
        );
      })}
    </svg>
  );
}
