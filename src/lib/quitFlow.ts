import { useEditorStore } from '../store/editorStore';
import { quitApp, syncBeforeQuit } from './tauri';

/** After this long we quit even if the final sync has not answered. */
export const QUIT_SYNC_TIMEOUT_MS = 40_000;

/** True while the editor holds an edit that is not on disk. */
function hasUnwrittenEdits(): boolean {
  const s = useEditorStore.getState();
  return s.isDirty || s.saveBlockedPath !== null || Object.keys(s.deferredWrites).length > 0;
}

/**
 * Write what the editor still holds: end every save hold (so deferred writes
 * run), then save the open note. A save-blocked note is never written over
 * (`saveNow` refuses it) and a deferred entry that fails stays deferred.
 * Resolves true when every edit reached the disk.
 */
export async function flushEditsForQuit(): Promise<boolean> {
  const editor = useEditorStore.getState();
  try {
    while (useEditorStore.getState().saveHolds > 0) {
      await editor.releaseSaves('unknown');
    }
    await useEditorStore.getState().saveNow();
  } catch (e) {
    console.error('flushing edits before quit failed:', e);
  }
  return !hasUnwrittenEdits();
}

/**
 * The quit is final: run the bounded last sync, then quit regardless of how
 * it went (`sync_before_quit` is a one-way door, sync stays off afterwards).
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
  await quitApp();
}
