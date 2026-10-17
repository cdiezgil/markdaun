import React from 'react';
import { Handle, Position } from '@xyflow/react';
import type { NodeProps } from '@xyflow/react';
import type { TagNodeData } from '../../store/graphStore';

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

/** TagNode — a #tag chip (sap/on-sap), shown when the Etiquetas filter is on. */
export function TagNode({ data: rawData }: NodeProps) {
  const data = rawData as TagNodeData & { dim?: boolean };
  return (
    <div
      data-testid={`tag-node-${data.label}`}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 'var(--space-1)',
        padding: '2px var(--space-2)',
        borderRadius: 'var(--radius-sm)',
        background: 'var(--sap)',
        color: 'var(--on-sap)',
        fontFamily: 'var(--font-sans)',
        fontSize: '12px',
        lineHeight: '16px',
        fontWeight: 500,
        whiteSpace: 'nowrap',
        opacity: data.dim ? 0.2 : 1,
      }}
    >
      <Handle type="target" position={Position.Top} isConnectable={false} style={centreHandle} />
      #{data.label}
      <span style={{ fontWeight: 400, opacity: 0.7 }}>{data.count}</span>
      <Handle type="source" position={Position.Top} isConnectable={false} style={centreHandle} />
    </div>
  );
}
