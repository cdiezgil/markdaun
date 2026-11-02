import React from 'react';
import { useSyncStore } from '../../store/syncStore';

/**
 * Connection footer. Sync itself is automatic: there are no push/pull buttons
 * and no badge; the status bar item shows the state.
 */
export function SyncPanel(): JSX.Element {
  const config = useSyncStore((s) => s.config);

  if (!config.isConnected) return <></>;

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
    />
  );
}
