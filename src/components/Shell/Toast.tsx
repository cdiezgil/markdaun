import React, { useEffect } from 'react';

const VISIBLE_MS = 3000;

/** A discreet, self-dismissing confirmation. */
export function Toast({ message, onDismiss }: { message: string | null; onDismiss(): void }): JSX.Element | null {
  useEffect(() => {
    if (!message) return;
    const t = setTimeout(onDismiss, VISIBLE_MS);
    return () => clearTimeout(t);
  }, [message, onDismiss]);

  if (!message) return null;
  return (
    <div
      data-testid="toast"
      role="status"
      aria-live="polite"
      style={{
        position: 'fixed',
        right: 'var(--space-6)',
        bottom: 'var(--space-12)',
        zIndex: 90,
        maxWidth: 360,
        padding: 'var(--space-2) var(--space-4)',
        background: 'var(--surface)',
        border: '1px solid var(--line)',
        borderRadius: 'var(--radius-md)',
        boxShadow: 'var(--shadow-pop)',
        color: 'var(--ink)',
        fontFamily: 'var(--font-sans)',
        fontSize: 13,
        lineHeight: '20px',
      }}
    >
      {message}
    </div>
  );
}
