import React, { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { ConfirmDialog } from '../ConfirmDialog/ConfirmDialog';
import { useSyncStore } from '../../store/syncStore';
import { useVaultStore } from '../../store/vaultStore';

function notes(n: number): string {
  return `${n} ${n === 1 ? 'nota' : 'notas'}`;
}

/**
 * Every question sync must ask before it may change anything:
 * the connect decision, the mass-deletion guard (open while the backend is paused for it),
 * and the conflicts notice.
 */
export function SyncDialogs(): JSX.Element {
  const navigate = useNavigate();
  const pendingConnect = useSyncStore((s) => s.pendingConnect);
  const pendingDeletion = useSyncStore((s) => s.pendingDeletion);
  const deletionPromptOpen = useSyncStore((s) => s.deletionPromptOpen);
  const conflicts = useSyncStore((s) => s.conflicts);
  const confirmConnect = useSyncStore((s) => s.confirmConnect);
  const cancelConnect = useSyncStore((s) => s.cancelConnect);
  const confirmDeletion = useSyncStore((s) => s.confirmDeletion);
  const cancelDeletion = useSyncStore((s) => s.cancelDeletion);
  const dismissConflicts = useSyncStore((s) => s.dismissConflicts);
  const syncNow = useSyncStore((s) => s.syncNow);
  const vaultPath = useVaultStore((s) => s.vaultPath);

  // After a restart the pause survives but its counts do not: a manual cycle
  // re-runs the guard and its report brings them (or lifts the pause).
  const countsUnknown = deletionPromptOpen && pendingDeletion === null;
  useEffect(() => {
    if (countsUnknown) void syncNow();
  }, [countsUnknown, syncNow]);

  const preview = pendingConnect?.preview;
  const downloading = preview?.case === 'local_empty';

  return (
    <>
      <ConfirmDialog
        open={pendingConnect !== null}
        tone="neutral"
        title={downloading ? 'Descargar notas de GitHub' : 'Sincronizar con GitHub'}
        description={
          downloading
            ? `El repositorio ya tiene ${notes(preview?.remoteCount ?? 0)}. ¿Descargarlas en esta carpeta?`
            : `El repositorio ya tiene ${notes(preview?.remoteCount ?? 0)} y esta carpeta tiene ${preview?.localCount ?? 0}. ¿Sincronizar? Se combinarán ambas; si una nota existe en los dos lados con contenido distinto se conservarán las dos versiones.`
        }
        confirmLabel={downloading ? 'Descargar' : 'Sincronizar'}
        onConfirm={() => void confirmConnect(downloading ? 'download' : 'sync')}
        onCancel={cancelConnect}
      />

      <ConfirmDialog
        open={deletionPromptOpen}
        title="Borrar notas en GitHub"
        description={
          pendingDeletion
            ? `Esta sincronización borraría ${pendingDeletion.deleted} de ${pendingDeletion.total} notas en GitHub. ¿Continuar?`
            : 'Comprobando cuántas notas se borrarían en GitHub…'
        }
        confirmLabel="Continuar"
        confirmDisabled={pendingDeletion === null}
        onConfirm={() => void confirmDeletion()}
        onCancel={cancelDeletion}
      />

      {conflicts.length > 0 && (
        <div
          data-testid="sync-conflicts"
          role="status"
          style={{
            position: 'fixed',
            right: 'var(--space-6)',
            bottom: 'var(--space-12)',
            zIndex: 90,
            maxWidth: 420,
            padding: 'var(--space-3) var(--space-4)',
            background: 'var(--surface)',
            border: '1px solid var(--line)',
            borderRadius: 'var(--radius-md)',
            boxShadow: 'var(--shadow-pop)',
            color: 'var(--ink)',
            fontFamily: 'var(--font-sans)',
            fontSize: 13,
            display: 'flex',
            flexDirection: 'column',
            gap: 'var(--space-2)',
          }}
        >
          <p style={{ margin: 0, fontWeight: 700, color: 'var(--amber)' }}>
            {conflicts.length === 1 ? 'Hay 1 conflicto' : `Hay ${conflicts.length} conflictos`}
          </p>
          <p style={{ margin: 0, color: 'var(--ink-muted)' }}>
            Se conservaron las dos versiones. Revisa la copia y quédate con lo que prefieras.
          </p>
          <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}>
            {conflicts.map((rel) => (
              <li key={rel}>
                <button
                  onClick={() =>
                    vaultPath && navigate(`/editor/${encodeURIComponent(`${vaultPath}/${rel}`)}`)
                  }
                  style={{
                    background: 'none',
                    border: 'none',
                    padding: 0,
                    cursor: 'pointer',
                    color: 'var(--daun)',
                    textDecoration: 'underline',
                    fontFamily: 'inherit',
                    fontSize: 13,
                    textAlign: 'left',
                  }}
                >
                  {rel}
                </button>
              </li>
            ))}
          </ul>
          <button
            onClick={() => void dismissConflicts()}
            style={{
              alignSelf: 'flex-end',
              background: 'transparent',
              border: 'none',
              color: 'var(--ink-muted)',
              cursor: 'pointer',
              fontFamily: 'inherit',
              fontSize: 13,
              padding: 'var(--space-1) var(--space-2)',
            }}
          >
            Cerrar
          </button>
        </div>
      )}
    </>
  );
}
