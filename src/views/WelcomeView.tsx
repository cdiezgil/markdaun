import React from 'react';

export function WelcomeView() {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        height: '100%',
        color: 'var(--ink-muted)',
        fontSize: 14,
      }}
    >
      Abre una nota o crea una nueva.
    </div>
  );
}
