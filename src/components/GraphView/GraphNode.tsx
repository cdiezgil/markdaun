import React from 'react';
import { Handle, Position } from '@xyflow/react';
import type { NodeProps } from '@xyflow/react';
import type { GraphNodeData } from '../../store/graphStore';

/**
 * GraphNode — TC-14, TC-15
 *
 * Custom React Flow node for vault files.
 * - `.md` files: left border 3px var(--daun).
 * - Selected: border var(--daun) + var(--shadow-pop).
 * - Handles hidden by default, visible on hover.
 */
export function GraphNode({ data: rawData, selected }: NodeProps) {
  const data = rawData as GraphNodeData;
  const isMd = data.kind === 'md';

  const baseStyle: React.CSSProperties = {
    background: 'var(--surface)',
    border: selected ? '1px solid var(--daun)' : '1px solid var(--line)',
    borderRadius: 'var(--radius-sm)',
    fontFamily: 'var(--font-sans)',
    fontSize: '12px',
    color: 'var(--ink)',
    padding: '6px 10px',
    minWidth: 80,
    cursor: 'pointer',
    boxShadow: selected ? 'var(--shadow-pop)' : 'none',
    borderLeft: isMd ? '3px solid var(--daun)' : undefined,
  };

  return (
    <div
      data-testid={`graph-node-${data.path}`}
      data-selected={selected ? 'true' : 'false'}
      data-kind={data.kind}
      style={baseStyle}
    >
      <Handle
        type="target"
        position={Position.Left}
        style={{ opacity: 0, width: 8, height: 8 }}
        className="graph-handle"
      />
      <span>{data.label}</span>
      <Handle
        type="source"
        position={Position.Right}
        style={{ opacity: 0, width: 8, height: 8 }}
        className="graph-handle"
      />
    </div>
  );
}
