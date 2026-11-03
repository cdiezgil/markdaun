import type { CSSProperties, ReactNode } from 'react';
import { ArrowLeft } from 'lucide-react';
import { navigate } from '../router';

export const primaryBtn: CSSProperties = {
  minHeight: 48,
  padding: '0 var(--space-6)',
  border: 'none',
  borderRadius: 'var(--radius-lg)',
  background: 'var(--gold)',
  color: 'var(--on-gold)',
  fontFamily: 'inherit',
  fontSize: 16,
  fontWeight: 700,
};

export const secondaryBtn: CSSProperties = {
  minHeight: 48,
  padding: '0 var(--space-4)',
  border: '1px solid var(--line-strong)',
  borderRadius: 'var(--radius-lg)',
  background: 'transparent',
  color: 'var(--ink)',
  fontFamily: 'inherit',
  fontSize: 15,
  fontWeight: 500,
};

export const inputStyle: CSSProperties = {
  width: '100%',
  minHeight: 48,
  padding: '0 var(--space-3)',
  border: '1px solid var(--line-strong)',
  borderRadius: 'var(--radius-lg)',
  background: 'var(--surface)',
  color: 'var(--ink)',
  fontFamily: 'inherit',
  fontSize: 16,
};

export function Page({ children }: { children: ReactNode }) {
  return <main className="app">{children}</main>;
}

export function BackBar({ title, to }: { title: string; to: string }) {
  return (
    <header className="bar">
      <button type="button" aria-label="Volver" className="icon-btn" onClick={() => navigate(to)}>
        <ArrowLeft size={20} strokeWidth={1.5} />
      </button>
      <strong>{title}</strong>
    </header>
  );
}
