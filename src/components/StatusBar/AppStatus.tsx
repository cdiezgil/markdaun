import React, { useEffect, useState } from 'react';
import { Check, CircleAlert, Loader, RefreshCw } from 'lucide-react';
import { useSyncStore } from '../../store/syncStore';
import { useEditorStore } from '../../store/editorStore';
import { onBrainIndexProgress, type IndexProgress } from '../../lib/tauri';

const itemStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 'var(--space-1)',
  whiteSpace: 'nowrap',
};

const ICON = { size: 14, strokeWidth: 1.5 } as const;

function SyncItem(): JSX.Element | null {
  const isConnected = useSyncStore((s) => s.config.isConnected);
  const hasChanges = useSyncStore((s) => s.status.hasChanges);
  const isLoading = useSyncStore((s) => s.isLoading);
  const error = useSyncStore((s) => s.error);
  if (!isConnected) return null;

  if (error) {
    return (
      <span data-testid="sync-status" title={error} style={{ ...itemStyle, color: 'var(--danger)' }}>
        <CircleAlert {...ICON} /> Error de sincronización
      </span>
    );
  }
  if (isLoading) {
    return (
      <span data-testid="sync-status" style={itemStyle}>
        <Loader {...ICON} /> Sincronizando
      </span>
    );
  }
  return (
    <span data-testid="sync-status" style={itemStyle}>
      {hasChanges ? <RefreshCw {...ICON} /> : <Check {...ICON} />}
      {hasChanges ? 'Cambios pendientes' : 'Al día'}
    </span>
  );
}

function SaveItem(): JSX.Element | null {
  const hasNote = useEditorStore((s) => s.activeNotePath !== null);
  const isDirty = useEditorStore((s) => s.isDirty);
  if (!hasNote) return null;
  return (
    <span data-testid="save-state" style={{ ...itemStyle, gap: 6 }}>
      <span
        aria-hidden="true"
        data-testid="save-dot"
        style={{
          width: 6,
          height: 6,
          borderRadius: 'var(--radius-pill)',
          background: isDirty ? 'var(--amber)' : 'var(--daun)',
          flexShrink: 0,
        }}
      />
      {isDirty ? 'Sin guardar' : 'Guardado'}
    </span>
  );
}

function IndexItem(): JSX.Element | null {
  const [progress, setProgress] = useState<IndexProgress | null>(null);
  const [completed, setCompleted] = useState<number | null>(null);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let cancelled = false;
    onBrainIndexProgress((p) => {
      if (p.done >= p.total && p.total > 0) {
        setProgress(null);
        setCompleted(p.total);
      } else {
        setProgress(p);
      }
    })
      .then((fn) => {
        if (cancelled) fn();
        else unlisten = fn;
      })
      .catch(() => {});
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, []);

  useEffect(() => {
    if (completed === null) return;
    const timer = setTimeout(() => setCompleted(null), 3000);
    return () => clearTimeout(timer);
  }, [completed]);

  if (completed !== null) {
    return (
      <span data-testid="index-completed" style={itemStyle}>
        <Check {...ICON} /> {completed} notas indexadas
      </span>
    );
  }
  if (!progress) return null;
  return (
    <span data-testid="index-status" style={itemStyle}>
      <Loader {...ICON} /> Indexando {progress.done}/{progress.total}
    </span>
  );
}

/** Left side of the status bar. The save state only exists in the notes view. */
export function AppStatus({ showSave }: { showSave: boolean }): JSX.Element {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-4)' }}>
      {showSave && <SaveItem />}
      <SyncItem />
      <IndexItem />
    </div>
  );
}
