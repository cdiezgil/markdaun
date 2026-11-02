import React from 'react';

/** Ecosystem seal `by { cdiezgil }`: the parent brand's signature (design/cdiezgil.md §5.4). */
export function Seal(): JSX.Element {
  return (
    <span
      data-testid="brand-seal"
      aria-label="by cdiezgil"
      style={{ whiteSpace: 'nowrap', fontFamily: 'var(--font-sans)', color: 'var(--ink-muted)' }}
    >
      <span aria-hidden="true" style={{ fontWeight: 300 }}>by </span>
      <span aria-hidden="true" style={{ fontWeight: 400, color: 'var(--daun)' }}>{'{ '}</span>
      <span aria-hidden="true" style={{ fontWeight: 700, color: 'var(--ink)' }}>cdiezgil</span>
      <span aria-hidden="true" style={{ fontWeight: 400, color: 'var(--daun)' }}>{' }'}</span>
    </span>
  );
}
