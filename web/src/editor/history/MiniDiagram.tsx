import type { StrategyDoc } from '@backupviiz/shared';

const W = 320, H = 180, PAD = 20, NW = 28, NH = 18;

/** Mini-diagramme SVG statique d'un document (aperçu d'une version). */
export default function MiniDiagram({ doc, label }: { doc: StrategyDoc; label: string }) {
  if (doc.nodes.length === 0) return <p className="vh-muted">Aucun nœud dans cette version.</p>;
  const xs = doc.nodes.map((n) => n.position.x), ys = doc.nodes.map((n) => n.position.y);
  const minX = Math.min(...xs), minY = Math.min(...ys);
  const sx = (W - 2 * PAD - NW) / Math.max(1, Math.max(...xs) - minX);
  const sy = (H - 2 * PAD - NH) / Math.max(1, Math.max(...ys) - minY);
  const s = Math.min(sx, sy, 1);
  const pos = new Map(doc.nodes.map((n) => [n.id, { x: PAD + (n.position.x - minX) * s, y: PAD + (n.position.y - minY) * s }]));
  return (
    <svg className="vh-diagram" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={label}>
      <defs>
        <marker id="vh-arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="6" markerHeight="6" orient="auto">
          <path d="M0 0L8 4L0 8z" fill="var(--muted)" />
        </marker>
      </defs>
      {doc.edges.map((e) => {
        const a = pos.get(e.from), b = pos.get(e.to);
        if (!a || !b) return null;
        return <line key={e.id} x1={a.x + NW / 2} y1={a.y + NH / 2} x2={b.x + NW / 2} y2={b.y + NH / 2} stroke="var(--muted)" strokeWidth="1.5" markerEnd="url(#vh-arrow)" />;
      })}
      {doc.nodes.map((n) => {
        const p = pos.get(n.id)!;
        return <rect key={n.id} x={p.x} y={p.y} width={NW} height={NH} rx="4" fill={n.kind === 'source' ? 'var(--accent)' : 'var(--surface-2)'} stroke={n.kind === 'source' ? 'var(--accent)' : 'var(--muted)'} strokeWidth="1.5" />;
      })}
    </svg>
  );
}
