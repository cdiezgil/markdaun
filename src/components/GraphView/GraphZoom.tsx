import React from 'react';
import { useReactFlow, useViewport } from '@xyflow/react';
import { Minus, Plus, Maximize } from 'lucide-react';

const btn: React.CSSProperties = {
  width: 32,
  height: 32,
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: 0,
  border: 0,
  borderRadius: 'var(--radius-md)',
  background: 'transparent',
  cursor: 'pointer',
};

/** Single zoom capsule: − / 100% / + / Ajustar. Replaces React Flow's controls. */
export function GraphZoom() {
  const { zoomIn, zoomOut, fitView } = useReactFlow();
  const { zoom } = useViewport();

  return (
    <div
      role="toolbar"
      aria-label="Zoom"
      data-testid="graph-zoom"
      style={{
        position: 'absolute',
        right: 'var(--space-6)',
        bottom: 'calc(var(--space-4) + var(--space-1))',
        zIndex: 10,
        display: 'flex',
        alignItems: 'center',
        gap: 2,
        padding: 'var(--space-1)',
        background: 'var(--surface)',
        border: '1px solid var(--line)',
        borderRadius: 'var(--radius-lg)',
        boxShadow: 'var(--shadow-pop)',
      }}
    >
      <button type="button" aria-label="Alejar" style={btn} onClick={() => zoomOut()}>
        <Minus size={18} strokeWidth={1.5} color="var(--ink-muted)" aria-hidden="true" />
      </button>
      <span
        data-testid="graph-zoom-level"
        style={{
          minWidth: 44,
          textAlign: 'center',
          fontFamily: 'var(--font-mono)',
          fontSize: '12px',
          lineHeight: '16px',
          fontWeight: 500,
          color: 'var(--ink-muted)',
        }}
      >
        {Math.round(zoom * 100)}%
      </span>
      <button type="button" aria-label="Acercar" style={btn} onClick={() => zoomIn()}>
        <Plus size={18} strokeWidth={1.5} color="var(--ink-muted)" aria-hidden="true" />
      </button>
      <span
        aria-hidden="true"
        style={{ width: 1, height: 18, background: 'var(--line)', margin: '0 var(--space-1)' }}
      />
      <button
        type="button"
        aria-label="Ajustar a la vista"
        style={btn}
        onClick={() => fitView({ duration: 200, padding: 0.2 })}
      >
        <Maximize size={18} strokeWidth={1.5} color="var(--ink-muted)" aria-hidden="true" />
      </button>
    </div>
  );
}
