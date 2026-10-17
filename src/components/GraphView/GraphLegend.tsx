import React from 'react';

const item: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 'var(--space-2)' };
const dot: React.CSSProperties = {
  width: 10,
  height: 10,
  boxSizing: 'border-box',
  borderRadius: 'var(--radius-pill)',
};

/** Bottom-left legend (Nota, Huérfana, Abierta) plus the React Flow attribution. */
export function GraphLegend() {
  return (
    <div
      data-testid="graph-legend"
      style={{
        position: 'absolute',
        left: 'var(--space-6)',
        bottom: 'calc(var(--space-4) + var(--space-1))',
        zIndex: 10,
        display: 'flex',
        flexWrap: 'wrap',
        alignItems: 'center',
        gap: 'var(--space-4)',
        fontFamily: 'var(--font-sans)',
        fontSize: '12px',
        lineHeight: '16px',
        color: 'var(--ink-muted)',
      }}
    >
      <span style={item}>
        <span aria-hidden="true" style={{ ...dot, background: 'var(--daun)' }} />
        Nota
      </span>
      <span style={item}>
        <span aria-hidden="true" style={{ ...dot, border: '2px solid var(--amber)' }} />
        Huérfana
      </span>
      <span style={item}>
        <span
          aria-hidden="true"
          style={{ ...dot, background: 'var(--daun)', boxShadow: '0 0 0 3px var(--sap)' }}
        />
        Abierta
      </span>
      <span style={{ opacity: 0.8 }}>React Flow</span>
    </div>
  );
}
