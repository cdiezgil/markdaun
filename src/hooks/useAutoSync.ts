import { useEffect, useRef } from 'react';
import {
  onSyncFinished,
  onSyncHoldRelease,
  onVaultChanged,
  onSyncWillStart,
  syncHoldAck,
  syncTrigger,
  type SyncState,
} from '../lib/tauri';
import {
  useEditorStore,
  onDeferredFlush,
  type DeferredFlushResult,
  type RemoteChangeResult,
} from '../store/editorStore';
import { useSyncStore } from '../store/syncStore';
import { useVaultStore } from '../store/vaultStore';

export const TOAST_RELOADED = 'Nota actualizada desde GitHub';
export const TOAST_DELETED = 'La nota se borró en GitHub';
export const TOAST_COPY_FAILED =
  'No se pudo guardar la versión de GitHub; tu texto sigue en el editor';
export const TOAST_WRITE_FAILED = 'No se pudo guardar la nota; tu texto sigue en el editor';

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
 * - releases write the notes switched away from during the cycle; every
 *   such flush (sync, rename/move, safety timer) is reported in one place;
 * - every successful save asks for a cycle (`changed`).
 */
export function useAutoSync(showToast: (message: string) => void): void {
  const toastRef = useRef(showToast);
  toastRef.current = showToast;
  // The last `sync-finished` handling: a new cycle's hold waits for it, so its
  // flush never runs between reading the open note and keeping its copy.
  const finishing = useRef<Promise<void>>(Promise.resolve());

  // The first cycle may finish before the listeners exist.
  useEffect(() => {
    void useSyncStore.getState().loadState();
  }, []);

  useTauriEvent(() =>
    onSyncWillStart(() => {
      useSyncStore.getState().markRunning(true);
      void finishing.current
        .then(() => useEditorStore.getState().holdSaves())
        .then(() => syncHoldAck())
        .catch(console.error);
    }),
  );

  useTauriEvent(() =>
    onSyncHoldRelease(() => {
      // No report: the deferred notes are checked against their disk content.
      // The flush result is reported through `onDeferredFlush`.
      useSyncStore.getState().markRunning(false);
      useEditorStore.getState().releaseSaves('unknown').catch(console.error);
    }),
  );

  useEffect(() => onDeferredFlush((deferred) => reportDeferred(deferred, (m) => toastRef.current(m))), []);

  useTauriEvent(() =>
    onSyncFinished((payload) => {
      finishing.current = finishing.current
        .then(() => handleFinished(payload, (m) => toastRef.current(m)))
        .catch(console.error);
    }),
  );

  // Files changed on disk outside the editor (an agent, a capture, a merge).
  useTauriEvent(() =>
    onVaultChanged(() => {
      void useVaultStore.getState().refreshTree();
    }),
  );

  // A save just landed on disk: let the scheduler debounce a cycle.
  useEffect(
    () =>
      useEditorStore.subscribe((s, prev) => {
        if (s.lastSavedAt !== null && s.lastSavedAt !== prev.lastSavedAt) {
          useSyncStore.getState().markPending();
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
  let release: Promise<DeferredFlushResult> | null = null;
  try {
    // Always ask: a note blocked by a failed conflict copy retries now.
    if (editor.vaultPath) {
      result = await editor.applyRemoteChanges(changed, editor.vaultPath);
    }
  } catch (e) {
    console.error('applyRemoteChanges failed:', e);
  } finally {
    release = useEditorStore.getState().releaseSaves(changed);
  }
  const copy = useEditorStore.getState().lastConflictCopy;
  const deferred = await release.catch((e: unknown): DeferredFlushResult => {
    console.error('deferred writes failed:', e);
    return { copies: [], written: 0, failed: false, writeFailed: false };
  });

  const sync = useSyncStore.getState();
  sync.applyFinished(payload);
  if (result === 'conflict' && copy !== null) sync.addConflicts([copy]);

  if (result === 'reloaded') toast(TOAST_RELOADED);
  else if (result === 'deleted') toast(TOAST_DELETED);
  // A deferred note's copy failure is already toasted by `reportDeferred`.
  else if (result === 'error' && !deferred.failed) toast(TOAST_COPY_FAILED);

  if (changed.length > 0) {
    // The vault tree reloads via `vaultChangeCount`; the editor's wikilink tree here.
    await useEditorStore.getState().refreshVaultTree().catch(console.error);
  }
}

/** Shows what a flush did with the notes whose writes waited for a hold. */
function reportDeferred(deferred: DeferredFlushResult, toast: (m: string) => void): void {
  if (deferred.copies.length > 0) useSyncStore.getState().addConflicts(deferred.copies);
  if (deferred.failed) toast(TOAST_COPY_FAILED);
  if (deferred.writeFailed) toast(TOAST_WRITE_FAILED);
  // Like a save: let the scheduler debounce a cycle for what was written.
  if (deferred.written > 0) {
    useSyncStore.getState().markPending();
    syncTrigger('changed').catch(() => {});
  }
}
