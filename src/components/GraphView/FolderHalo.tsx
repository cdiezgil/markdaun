import React from 'react';
import type { NodeProps } from '@xyflow/react';

export interface FolderHaloData extends Record<string, unknown> {
  folder: string;
}

/** FolderHalo — a barely-there green halo with an uppercase folder label. */
export function FolderHalo({ data: rawData }: NodeProps) {
  const { folder } = rawData as FolderHaloData;
  return (
    <div
      data-testid={`folder-halo-${folder}`}
      style={{
        position: 'relative',
        width: '100%',
        height: '100%',
        borderRadius: 'var(--radius-pill)',
        background: 'color-mix(in srgb, var(--daun) 5%, transparent)',
        pointerEvents: 'none',
      }}
    >
      <span
        style={{
          position: 'absolute',
          top: 'var(--space-4)',
          left: '50%',
          transform: 'translateX(-50%)',
          fontFamily: 'var(--font-sans)',
          fontSize: '11px',
          lineHeight: '16px',
          fontWeight: 500,
          letterSpacing: '0.04em',
          textTransform: 'uppercase',
          color: 'var(--ink-muted)',
          whiteSpace: 'nowrap',
        }}
      >
        {folder}
      </span>
    </div>
  );
}
