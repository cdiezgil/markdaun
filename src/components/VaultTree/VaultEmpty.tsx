import React from 'react';
import { useVaultStore } from '../../store/vaultStore';

export function VaultEmpty() {
  const openVault = useVaultStore((s) => s.openVault);

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 'var(--space-4)',
        padding: 'var(--space-6)',
        height: '100%',
        textAlign: 'center',
      }}
    >
      <p
        style={{
          fontSize: 14,
          color: 'var(--ink-muted)',
        }}
      >
        Nada por aquí todavía. Abre una carpeta para empezar.
      </p>
      <button
        onClick={openVault}
        data-testid="open-vault-btn"
        style={{
          background: 'var(--daun)',
          color: 'var(--on-daun)',
          border: 'none',
          borderRadius: 'var(--radius-sm)',
          padding: 'var(--space-2) var(--space-4)',
          fontSize: 14,
          fontWeight: 500,
          cursor: 'pointer',
        }}
      >
        Abrir bóveda
      </button>
    </div>
  );
}
