import { useEffect, useRef } from 'react';
import {
  onSyncFinished,
  onSyncHoldRelease,
  onSyncWillStart,
  syncHoldAck,
  syncTrigger,
  type SyncState,
} from '../lib/tauri';
import { useEditorStore, type RemoteChangeResult } from '../store/editorStore';
import { useSyncStore } from '../store/syncStore';

export const TOAST_RELOADED = 'Nota actualizada desde GitHub';
export const TOAST_DELETED = 'La nota se borró en GitHub';

/** Subscribe to a Tauri event for the component's lifetime. */
function useTauriEvent(subscribe: () => Promise<() => void>): void {
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let cancelled = false;
    subscribe()
      .then((fn) => (cancelled ? fn() : (unlisten = fn)))
      .catch(console.error);
    return () => {
      cancelled = true;
      unlisten?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}

/**
 * Editor side of the automatic sync handshake (orchestration lives in Rust):
 * - `sync-will-start`: flush and hold saves, then ack;
 * - `sync-finished`: apply remote changes to the open note, release the hold,
 *   store the state and toast; `sync-hold-release` only releases;
 * - every successful save asks for a cycle (`changed`).
 */
export function useAutoSync(showToast: (message: string) => void): void {
  const toastRef = useRef(showToast);
  toastRef.current = showToast;

  // The first cycle may finish before the listeners exist.
  useEffect(() => {
    void useSyncStore.getState().loadState();
  }, []);

  useTauriEvent(() =>
    onSyncWillStart(() => {
      void useEditorStore
        .getState()
        .holdSaves()
        .then(() => syncHoldAck())
        .catch(console.error);
    }),
  );

  useTauriEvent(() =>
    onSyncHoldRelease(() => {
      useEditorStore.getState().releaseSaves();
    }),
  );

  useTauriEvent(() =>
    onSyncFinished((payload) => {
      void handleFinished(payload, (m) => toastRef.current(m));
    }),
  );

  // A save just landed on disk: let the scheduler debounce a cycle.
  useEffect(
    () =>
      useEditorStore.subscribe((s, prev) => {
        if (s.lastSavedAt !== null && s.lastSavedAt !== prev.lastSavedAt) {
          syncTrigger('changed').catch(() => {
            // Not connected: nothing to sync.
          });
        }
      }),
    [],
  );
}

async function handleFinished(payload: SyncState, toast: (m: string) => void): Promise<void> {
  const editor = useEditorStore.getState();
  const changed = payload.report?.changedPaths ?? [];
  let result: RemoteChangeResult = 'none';
  try {
    if (changed.length > 0 && editor.vaultPath) {
      result = await editor.applyRemoteChanges(changed, editor.vaultPath);
    }
  } catch (e) {
    console.error('applyRemoteChanges failed:', e);
  } finally {
    useEditorStore.getState().releaseSaves();
  }

  const sync = useSyncStore.getState();
  sync.applyFinished(payload);
  const copy = useEditorStore.getState().lastConflictCopy;
  if (result === 'conflict' && copy !== null) sync.addConflicts([copy]);

  if (result === 'reloaded') toast(TOAST_RELOADED);
  else if (result === 'deleted') toast(TOAST_DELETED);

  if (changed.length > 0) {
    // The vault tree reloads via `vaultChangeCount`; the editor's wikilink tree here.
    await useEditorStore.getState().refreshVaultTree().catch(console.error);
  }
}
