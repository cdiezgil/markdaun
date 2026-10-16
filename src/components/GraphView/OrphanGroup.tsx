import React from 'react';
import type { NodeProps } from '@xyflow/react';
import type { OrphanGroupData } from '../../store/graphStore';

/**
 * OrphanGroup — TC-10, TC-17
 *
 * React Flow group node representing a subfolder's orphan files.
 * - Background: var(--surface-sunken) at 70% opacity.
 * - Border: 1px dashed var(--line).
 * - Label (folder name) in top-left corner.
 * - No connection handles.
 */
export function OrphanGroup({ data: rawData }: NodeProps) {
  const data = rawData as OrphanGroupData;
  return (
    <div
      data-testid={`orphan-group-${data.folderName}`}
      style={{
        width: '100%',
        height: '100%',
        background: 'var(--surface-sunken)',
        opacity: 0.7,
        border: '1px dashed var(--line)',
        borderRadius: 'var(--radius-md)',
        position: 'relative',
        pointerEvents: 'none',
      }}
    >
      <span
        data-testid={`orphan-group-label-${data.folderName}`}
        style={{
          position: 'absolute',
          top: 6,
          left: 8,
          fontFamily: 'var(--font-sans)',
          fontSize: '11px',
          color: 'var(--ink-muted)',
          userSelect: 'none',
        }}
      >
        {data.folderName}
      </span>
    </div>
  );
}
