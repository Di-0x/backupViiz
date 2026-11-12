export function Skeleton({ height = 16, width = '100%', radius = 6 }: { height?: number | string; width?: number | string; radius?: number }) {
  return <span className="skeleton" aria-hidden="true" style={{ height, width, borderRadius: radius }} />;
}

export function CardSkeletons({ count = 6 }: { count?: number }) {
  return (
    <div className="grid" role="status" aria-label="Chargement des stratégies">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="card strategy-card" aria-hidden="true">
          <Skeleton height={20} width="60%" />
          <Skeleton height={14} />
          <Skeleton height={14} width="80%" />
          <Skeleton height={32} width="40%" radius={16} />
        </div>
      ))}
    </div>
  );
}
