import React, { useEffect, useState } from 'react';
import { Check, CircleAlert, Loader, RefreshCw, Save } from 'lucide-react';
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
        <CircleAlert {...ICON} /> Sync error
      </span>
    );
  }
  if (isLoading) {
    return (
      <span data-testid="sync-status" style={itemStyle}>
        <Loader {...ICON} /> Syncing
      </span>
    );
  }
  return (
    <span data-testid="sync-status" style={itemStyle}>
      {hasChanges ? <RefreshCw {...ICON} /> : <Check {...ICON} />}
      {hasChanges ? 'Changes pending' : 'Up to date'}
    </span>
  );
}

function SaveItem(): JSX.Element | null {
  const hasNote = useEditorStore((s) => s.activeNotePath !== null);
  const saveStatus = useEditorStore((s) => s.saveStatus);
  if (!hasNote) return null;
  return (
    <span data-testid="save-state" style={itemStyle}>
      <Save {...ICON} /> {saveStatus === 'saving' ? 'Unsaved' : 'Saved'}
    </span>
  );
}

function IndexItem(): JSX.Element | null {
  const [progress, setProgress] = useState<IndexProgress | null>(null);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let cancelled = false;
    onBrainIndexProgress((p) => setProgress(p.done >= p.total ? null : p))
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

  if (!progress) return null;
  return (
    <span data-testid="index-status" style={itemStyle}>
      <Loader {...ICON} /> Indexing {progress.done}/{progress.total}
    </span>
  );
}

export function AppStatus(): JSX.Element {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-4)' }}>
      <SyncItem />
      <SaveItem />
      <IndexItem />
    </div>
  );
}
