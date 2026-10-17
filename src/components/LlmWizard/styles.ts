import type { CSSProperties } from 'react';

// Shared styles for the wizard. Tokens only (design/tokens.css).

export const overlay: CSSProperties = {
  position: 'fixed',
  inset: 0,
  backgroundColor: 'color-mix(in srgb, var(--ink) 40%, transparent)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  zIndex: 60,
};

export const modal: CSSProperties = {
  background: 'var(--surface)',
  border: '1px solid var(--line)',
  borderRadius: 'var(--radius-lg)',
  boxShadow: 'var(--shadow-pop)',
  width: 'min(720px, 92vw)',
  maxHeight: '88vh',
  overflow: 'auto',
  padding: 'var(--space-6)',
  fontFamily: 'var(--font-sans)',
  color: 'var(--ink)',
  display: 'flex',
  flexDirection: 'column',
  gap: 'var(--space-4)',
};

export const title: CSSProperties = { fontSize: 20, fontWeight: 600, margin: 0, color: 'var(--ink)' };
export const muted: CSSProperties = { fontSize: 13, color: 'var(--ink-muted)', margin: 0 };
export const errorText: CSSProperties = { fontSize: 13, color: 'var(--danger)', margin: 0 };

export const cardGrid: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
  gap: 'var(--space-3)',
};

export const card: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 'var(--space-2)',
  alignItems: 'flex-start',
  textAlign: 'left',
  background: 'var(--surface)',
  border: '1px solid var(--line-strong)',
  borderRadius: 'var(--radius-md)',
  padding: 'var(--space-4)',
  fontFamily: 'var(--font-sans)',
  color: 'var(--ink)',
  cursor: 'pointer',
};

export const field: CSSProperties = { display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' };
export const label: CSSProperties = { fontSize: 13, fontWeight: 500, color: 'var(--ink)' };

export const input: CSSProperties = {
  background: 'var(--surface)',
  border: '1px solid var(--line)',
  borderRadius: 'var(--radius-sm)',
  padding: 'var(--space-2) var(--space-3)',
  fontFamily: 'var(--font-sans)',
  fontSize: 14,
  color: 'var(--ink)',
  boxSizing: 'border-box',
  width: '100%',
};

const buttonBase: CSSProperties = {
  borderRadius: 'var(--radius-md)',
  padding: 'var(--space-2) var(--space-3)',
  fontFamily: 'var(--font-sans)',
  fontSize: 13,
  fontWeight: 500,
  cursor: 'pointer',
};

export const primaryButton: CSSProperties = {
  ...buttonBase,
  background: 'var(--daun)',
  color: 'var(--on-daun)',
  border: 'none',
};

export const secondaryButton: CSSProperties = {
  ...buttonBase,
  background: 'var(--surface)',
  color: 'var(--ink)',
  border: '1px solid var(--line-strong)',
};

export const ghostButton: CSSProperties = {
  ...buttonBase,
  background: 'transparent',
  color: 'var(--ink-muted)',
  border: 'none',
};

export const footer: CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  gap: 'var(--space-3)',
  marginTop: 'var(--space-2)',
};

export function disabled(style: CSSProperties, isDisabled: boolean): CSSProperties {
  return isDisabled ? { ...style, opacity: 0.5, cursor: 'not-allowed' } : style;
}
