import { useEditorStore } from '../store/editorStore';
import { quitApp, syncBeforeQuit, syncCancelQuit } from './tauri';

/** After this long we quit even if the final sync has not answered. */
export const QUIT_SYNC_TIMEOUT_MS = 40_000;

/** True while the editor holds an edit that is not on disk. */
function hasUnwrittenEdits(): boolean {
  const s = useEditorStore.getState();
  return s.isDirty || s.saveBlockedPath !== null || Object.keys(s.deferredWrites).length > 0;
}

/** The flush gives up after this long; the user then decides (see App). */
export const QUIT_FLUSH_TIMEOUT_MS = 15_000;

/**
 * Resolves once no save hold is open. Holds are never ended early here: a
 * sync hold ends when its cycle does (the backend's quit path waits for a
 * running cycle anyway), so the open note is still checked against what the
 * cycle merged before it is written.
 */
function holdsEnded(): Promise<void> {
  if (useEditorStore.getState().saveHolds === 0) return Promise.resolve();
  return new Promise((resolve) => {
    const unsubscribe = useEditorStore.subscribe((s) => {
      if (s.saveHolds === 0) {
        unsubscribe();
        resolve();
      }
    });
  });
}

async function flushOnce(): Promise<boolean> {
  try {
    await holdsEnded();
    await useEditorStore.getState().flushEdits();
  } catch (e) {
    console.error('flushing edits before quit failed:', e);
  }
  return !hasUnwrittenEdits();
}

/**
 * Write what the editor still holds: wait for every save hold to end (their
 * releases write the deferred notes), then flush the open note through its
 * remote-change check. A save-blocked note is never written over and a
 * deferred entry that fails stays deferred. Resolves true only when every
 * edit reached the disk; a hung write, or holds that never end, resolve
 * false after a time bound.
 */
export async function flushEditsForQuit(): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<boolean>((resolve) => {
    timer = setTimeout(() => resolve(false), QUIT_FLUSH_TIMEOUT_MS);
  });
  try {
    return await Promise.race([flushOnce(), timeout]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

/**
 * Run the bounded last sync, then quit regardless of how it went. If the app
 * does not exit after all, `sync_before_quit` is undone (lock released, sync
 * resumed) and the error is rethrown so the caller can let the user retry.
 */
export async function finishQuit(syncFirst: boolean): Promise<void> {
  if (syncFirst) {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<void>((resolve) => {
      timer = setTimeout(resolve, QUIT_SYNC_TIMEOUT_MS);
    });
    try {
      await Promise.race([syncBeforeQuit(), timeout]);
    } catch (e) {
      console.error('sync before quit failed:', e);
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  }
  try {
    await quitApp();
  } catch (e) {
    if (syncFirst) await syncCancelQuit().catch(console.error);
    throw e;
  }
}
