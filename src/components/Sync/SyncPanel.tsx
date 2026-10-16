import React from 'react';
import { ArrowUp, ArrowDown } from 'lucide-react';
import { useSyncStore } from '../../store/syncStore';
import { useVaultStore } from '../../store/vaultStore';

export function SyncPanel(): JSX.Element {
  const config = useSyncStore((s) => s.config);
  const status = useSyncStore((s) => s.status);
  const isLoading = useSyncStore((s) => s.isLoading);
  const push = useSyncStore((s) => s.push);
  const pull = useSyncStore((s) => s.pull);
  const vaultPath = useVaultStore((s) => s.vaultPath);

  if (!config.isConnected) return <></>;

  const handlePush = () => {
    if (vaultPath) push(vaultPath);
  };

  const handlePull = () => {
    if (vaultPath) pull(vaultPath);
  };

  return (
    <div
      data-testid="sync-panel"
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: 'var(--space-2) var(--space-3)',
        borderTop: '1px solid var(--line)',
        background: 'var(--surface-sunken)',
      }}
    >
      {/* Left: pending-changes badge */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
        {status.hasChanges && (
          <span
            data-testid="sync-badge"
            title="Cambios locales sin sincronizar"
            style={{
              width: 8,
              height: 8,
              borderRadius: '50%',
              background: 'var(--amber)',
              display: 'inline-block',
              flexShrink: 0,
            }}
          />
        )}
      </div>

      {/* Right: push / pull icon buttons */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-1)' }}>
        <button
          data-testid="sync-push-btn"
          onClick={handlePush}
          disabled={isLoading}
          title="Subir cambios (push)"
          style={{
            background: 'none',
            border: 'none',
            cursor: isLoading ? 'not-allowed' : 'pointer',
            color: 'var(--ink-muted)',
            display: 'flex',
            alignItems: 'center',
            padding: 'var(--space-1)',
            borderRadius: 'var(--radius-sm)',
          }}
        >
          <ArrowUp size={18} strokeWidth={1.5} />
        </button>
        <button
          data-testid="sync-pull-btn"
          onClick={handlePull}
          disabled={isLoading}
          title="Descargar cambios (pull)"
          style={{
            background: 'none',
            border: 'none',
            cursor: isLoading ? 'not-allowed' : 'pointer',
            color: 'var(--ink-muted)',
            display: 'flex',
            alignItems: 'center',
            padding: 'var(--space-1)',
            borderRadius: 'var(--radius-sm)',
          }}
        >
          <ArrowDown size={18} strokeWidth={1.5} />
        </button>
      </div>
    </div>
  );
}
