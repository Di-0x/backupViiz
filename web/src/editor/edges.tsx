import { memo } from 'react';
import { BaseEdge, EdgeLabelRenderer, getBezierPath } from '@xyflow/react';
import type { Edge, EdgeProps } from '@xyflow/react';

export interface BackupEdgeData extends Record<string, unknown> {
  method?: string;
  schedule?: string;
  missingSchedule?: boolean;
}
export type BackupFlowEdge = Edge<BackupEdgeData, 'backup'>;

export const BackupEdgeView = memo(function BackupEdgeView(p: EdgeProps<BackupFlowEdge>) {
  const [path, lx, ly] = getBezierPath({
    sourceX: p.sourceX,
    sourceY: p.sourceY,
    targetX: p.targetX,
    targetY: p.targetY,
    sourcePosition: p.sourcePosition,
    targetPosition: p.targetPosition,
  });
  const label = [p.data?.method, p.data?.schedule].filter(Boolean).join(' · ');
  return (
    <>
      <BaseEdge
        id={p.id}
        path={path}
        markerEnd={p.markerEnd}
        interactionWidth={24}
        className={p.data?.missingSchedule ? 'bv-edge bv-edge--nosched' : 'bv-edge'}
      />
      {label && (
        <EdgeLabelRenderer>
          <div
            className={`bv-edge-label${p.selected ? ' is-selected' : ''}`}
            style={{ transform: `translate(-50%, -50%) translate(${lx}px, ${ly}px)` }}
          >
            {label}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
});
