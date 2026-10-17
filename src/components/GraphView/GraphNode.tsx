import React from 'react';
import { Handle, Position } from '@xyflow/react';
import type { NodeProps } from '@xyflow/react';
import type { GraphNodeData } from '../../store/graphStore';

/** View-state flags the canvas merges into each node's data. */
export interface GraphNodeView {
  /** The note open in the editor. */
  active?: boolean;
  /** The node picked in the graph (shown in the side card). */
  selected?: boolean;
  /** Does not match the current search. */
  dim?: boolean;
}

const centreHandle: React.CSSProperties = {
  top: '50%',
  left: '50%',
  width: 1,
  height: 1,
  minWidth: 0,
  minHeight: 0,
  border: 0,
  opacity: 0,
  pointerEvents: 'none',
};

/**
 * GraphNode — a filled circle sized by backlinks, label underneath.
 * Open note: sap ring + bolder label. Orphan: hollow, amber outline and label.
 */
export function GraphNode({ data: rawData }: NodeProps) {
  const data = rawData as GraphNodeData & GraphNodeView;
  const d = data.diameter;

  const ring = data.active
    ? '0 0 0 5px var(--sap)'
    : data.selected
      ? '0 0 0 3px var(--selection)'
      : 'none';

  return (
    <div
      data-testid={`graph-node-${data.path}`}
      data-kind={data.kind}
      data-orphan={data.isOrphan ? 'true' : 'false'}
      data-active={data.active ? 'true' : 'false'}
      style={{
        position: 'relative',
        width: d,
        height: d,
        opacity: data.dim ? 0.2 : 1,
        cursor: 'pointer',
      }}
    >
      <Handle type="target" position={Position.Top} isConnectable={false} style={centreHandle} />
      <span
        aria-hidden="true"
        data-testid="graph-node-dot"
        style={{
          display: 'block',
          width: '100%',
          height: '100%',
          boxSizing: 'border-box',
          borderRadius: 'var(--radius-pill)',
          background: data.isOrphan ? 'var(--bg)' : 'var(--daun)',
          border: data.isOrphan ? '2px solid var(--amber)' : 'none',
          boxShadow: ring,
        }}
      />
      <span
        data-testid="graph-node-label"
        style={{
          position: 'absolute',
          top: '100%',
          left: '50%',
          transform: 'translateX(-50%)',
          marginTop: 'var(--space-2)',
          padding: '0 var(--space-1)',
          background: 'var(--bg)',
          borderRadius: 'var(--radius-sm)',
          whiteSpace: 'nowrap',
          fontFamily: 'var(--font-sans)',
          fontSize: data.active ? '13px' : '12px',
          lineHeight: data.active ? '18px' : '16px',
          fontWeight: data.active ? 600 : 400,
          color: data.isOrphan ? 'var(--amber)' : 'var(--ink)',
        }}
      >
        {data.label}
      </span>
      <Handle type="source" position={Position.Top} isConnectable={false} style={centreHandle} />
    </div>
  );
}
