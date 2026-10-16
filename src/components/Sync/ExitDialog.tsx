import React, { useEffect } from 'react';

export interface ExitDialogProps {
  open: boolean;
  isSyncing: boolean;
  onSyncAndQuit(): void;
  onQuit(): void;
  onCancel(): void;
}

export function ExitDialog({
  open,
  isSyncing,
  onSyncAndQuit,
  onQuit,
  onCancel,
}: ExitDialogProps): JSX.Element {
  useEffect(() => {
    if (!open) return;
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onCancel();
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [open, onCancel]);

  if (!open) return <></>;

  return (
    <div
      data-testid="exit-dialog"
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: 'rgba(0,0,0,0.4)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 100,
      }}
    >
      <div
        style={{
          background: 'var(--surface)',
          borderRadius: 'var(--radius-lg)',
          boxShadow: 'var(--shadow-pop)',
          padding: 'var(--space-6)',
          minWidth: 320,
          maxWidth: 400,
          display: 'flex',
          flexDirection: 'column',
          gap: 'var(--space-3)',
        }}
        role="dialog"
        aria-modal="true"
      >
        <p style={{ fontSize: 15, fontWeight: 600, margin: 0 }}>
          Cambios sin sincronizar
        </p>
        <p style={{ fontSize: 14, color: 'var(--ink-muted)', margin: 0 }}>
          Tienes cambios locales que no se han subido al repositorio remoto.
          ¿Qué quieres hacer?
        </p>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
          {/* Primary: Sync and quit */}
          <button
            data-testid="exit-sync-quit-btn"
            onClick={onSyncAndQuit}
            disabled={isSyncing}
            style={{
              background: 'var(--daun)',
              color: 'var(--on-daun)',
              border: 'none',
              borderRadius: 'var(--radius-sm)',
              padding: 'var(--space-3) var(--space-4)',
              fontSize: 14,
              fontWeight: 500,
              cursor: isSyncing ? 'not-allowed' : 'pointer',
              width: '100%',
            }}
          >
            {isSyncing ? 'Sincronizando…' : 'Sincronizar y salir'}
          </button>

          {/* Ghost: Quit without syncing */}
          <button
            data-testid="exit-quit-btn"
            onClick={onQuit}
            disabled={isSyncing}
            style={{
              background: 'transparent',
              color: 'var(--ink)',
              border: 'none',
              borderRadius: 'var(--radius-sm)',
              padding: 'var(--space-3) var(--space-4)',
              fontSize: 14,
              cursor: isSyncing ? 'not-allowed' : 'pointer',
              width: '100%',
            }}
          >
            Salir sin sincronizar
          </button>

          {/* Ghost: Cancel */}
          <button
            data-testid="exit-cancel-btn"
            onClick={onCancel}
            disabled={isSyncing}
            style={{
              background: 'transparent',
              color: 'var(--ink-muted)',
              border: 'none',
              borderRadius: 'var(--radius-sm)',
              padding: 'var(--space-3) var(--space-4)',
              fontSize: 14,
              cursor: isSyncing ? 'not-allowed' : 'pointer',
              width: '100%',
            }}
          >
            Cancelar
          </button>
        </div>
      </div>
    </div>
  );
}
