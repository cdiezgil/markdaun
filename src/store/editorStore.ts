import { create } from 'zustand';
import {
  readNote,
  writeNote,
  getActiveVault,
  listVaultTree,
  convertAssetSrc,
  brainUpdateEmbedding,
  chatWriteNote,
  writeConflictCopy,
  type VaultEntry,
} from '../lib/tauri';

// ── Types ──────────────────────────────────────────────────────────────────────

export type SaveStatus = 'idle' | 'saving' | 'saved';

/** What a sync cycle did to the open note (see `applyRemoteChanges`). */
export type RemoteChangeResult = 'none' | 'reloaded' | 'conflict' | 'deleted' | 'error';

/** A note switched away from during a sync hold, waiting for the release. */
export interface DeferredWrite {
  /** Editor buffer (load form; converted to disk form when written). */
  content: string;
  vault: string;
  /** Disk content the editor last read or wrote for the note, or null if unknown. */
  base: string | null;
  /** The remote version was never kept: copy it before writing, always. */
  blocked: boolean;
}

/** What a release did with the deferred writes (see `releaseSaves`). */
export interface DeferredFlushResult {
  /** Vault-relative conflict copies written. */
  copies: string[];
  /** Notes written to disk. */
  written: number;
  /** A remote version could not be kept; its note stays deferred. */
  failed: boolean;
  /** A note could not be read or written; its buffer stays pending. */
  writeFailed: boolean;
}

/**
 * Remote changes reported to `releaseSaves`: the cycle's vault-relative
 * changed paths, or `'unknown'` when the cycle ended without a report.
 */
export type ReleaseRemote = string[] | 'unknown';

export interface EditorState {
  activeNotePath: string | null;
  activeNoteContent: string | null;
  vaultPath: string | null;
  vaultTree: VaultEntry[];
  saveStatus: SaveStatus;
  /** Epoch ms of the last successful save in this session, or null. */
  lastSavedAt: number | null;
  /** True while the editor holds edits that are not yet persisted to disk. */
  isDirty: boolean;
  /** Plain text currently selected in the editor ('' when none). */
  selectionText: string;
  /** Bumped every time a note is (re)loaded from disk; the editor reloads on change. */
  loadVersion: number;
  /** When true the editor puts the cursor in the H1 once the next note loads. */
  focusTitleOnOpen: boolean;
  /** Last rename/move of the active note (lets the route follow the new path). */
  relocation: { from: string; to: string } | null;
  /**
   * Open save holds (rename/move, sync cycles). Saves are deferred while > 0;
   * typing keeps updating the buffer and the pending save runs on release.
   */
  saveHolds: number;
  /** Vault-relative conflict copy written by the last `applyRemoteChanges`, or null. */
  lastConflictCopy: string | null;
  /**
   * Note whose saves are blocked because the remote version on disk could not
   * be kept as a conflict copy (writing the buffer would overwrite it). The
   * next `applyRemoteChanges` retries; opening another note lifts it.
   */
  saveBlockedPath: string | null;
  /**
   * Notes switched away from while a sync cycle held saves, by absolute path
   * (latest buffer wins). Written on release under the remote-change rules.
   */
  deferredWrites: Record<string, DeferredWrite>;
  /** Disk content the editor last read or wrote for the open note, or null. */
  diskContent: string | null;

  // Actions
  openNote(absolutePath: string): Promise<void>;
  setContent(markdown: string): void;
  setSelectionText(text: string): void;
  saveNow(): Promise<void>;
  /**
   * Write the open note's edits the safe way, never ending a hold: waits for
   * a rename/move and a running check, runs a pending remote-change check
   * (conflict copy first), then saves if the buffer is dirty. Used by quit.
   */
  flushEdits(): Promise<void>;
  /** True while quitting: the editor is read-only so no keystroke is lost after the final flush. */
  editLocked: boolean;
  setEditLocked(locked: boolean): void;
  initVault(): Promise<void>;
  /** Reloads the tree the editor resolves wikilinks against. */
  refreshVaultTree(): Promise<void>;
  /**
   * Runs a rename/move: pending edits are flushed first and saves are held
   * back while it runs, so nothing is written to a path that is going away.
   * `finish` (typically `applyRelocation`) runs after the hold ends; a note
   * switch meanwhile waits for both before flushing to the new path.
   * `moved` names what the relocation moved, so deferred writes follow it
   * before the hold ends (their flush may run at that release).
   */
  runRelocation<T>(
    run: () => Promise<T>,
    finish?: (result: T) => Promise<void>,
    moved?: (result: T) => { from: string; to: string } | null,
  ): Promise<T>;
  /**
   * `from` (a note or folder) now lives at `to`. Keeps the active note's
   * unsaved content and cursor, refreshes the tree, and reloads the active
   * note when `rewritten` shows links in it changed on disk.
   */
  applyRelocation(from: string, to: string, rewritten: string[]): Promise<void>;
  /** Flush the pending debounced save, then hold saves until `releaseSaves`. */
  holdSaves(): Promise<void>;
  /**
   * End one hold; the deferred save runs when the last hold ends, and so do
   * the deferred writes of notes switched away from meanwhile. `remote` is
   * what the sync cycle changed (omit for a rename/move).
   */
  releaseSaves(remote?: ReleaseRemote): Promise<DeferredFlushResult>;
  /**
   * A sync cycle changed `changedPaths` (vault-relative). Reloads, closes or
   * keeps the open note; unsaved edits always win and the remote version is
   * kept as a conflict copy. Writes the buffer even while saves are held.
   * `'error'`: the remote version could not be kept, saves to the note are
   * blocked and the buffer stays dirty until a later call succeeds.
   */
  applyRemoteChanges(changedPaths: string[], vaultPath: string): Promise<RemoteChangeResult>;
}

// ── Internal debounce ref (module-level, not in store state) ───────────────────

let debounceTimer: ReturnType<typeof setTimeout> | null = null;
/** Settles when the running rename/move (including its `finish`) is done. */
let relocationInFlight: Promise<void> | null = null;
/** Forces a stuck hold off: a lost release event must never keep typing unsaved. */
let holdSafetyTimer: ReturnType<typeof setTimeout> | null = null;
/** Settles when the running flush of deferred writes is done. */
let deferredFlush: Promise<DeferredFlushResult> | null = null;
/** Remote changes reported by releases since the last deferred flush. */
let releasedChanges = new Set<string>();
let releasedUnknown = false;
/**
 * A deferred note reopened while saves were held: its buffer is still checked
 * against `base` (disk content at deferral) when the hold ends.
 */
let reopenedDuringHold: { path: string; base: string | null } | null = null;
/** The open note is being checked against disk: no save may run meanwhile. */
let openCheckPath: string | null = null;
/**
 * Monotonically increasing counter bumped at the start of every `openNote`
 * call. When a concurrent call starts after this one, the stale result is
 * discarded (last-caller-wins; prevents wrong-note display after rapid clicks).
 */
let openNoteSeq = 0;
const flushListeners = new Set<(result: DeferredFlushResult) => void>();

/**
 * Every completed flush of deferred writes (sync releases, relocation
 * releases, the safety timer) is reported here. Returns the unsubscribe.
 */
export function onDeferredFlush(listener: (result: DeferredFlushResult) => void): () => void {
  flushListeners.add(listener);
  return () => {
    flushListeners.delete(listener);
  };
}

function emptyFlushResult(): DeferredFlushResult {
  return { copies: [], written: 0, failed: false, writeFailed: false };
}

const SAVE_DEBOUNCE_MS = 1000;
export const SAVE_HOLD_MAX_MS = 60_000;

function clearDebounce(): void {
  if (debounceTimer !== null) {
    clearTimeout(debounceTimer);
    debounceTimer = null;
  }
}

/** `abs` relative to `vault` with `/` separators, or null when outside it. */
function vaultRelative(abs: string, vault: string): string | null {
  const a = abs.replace(/\\/g, '/');
  const v = vault.replace(/\\/g, '/').replace(/\/+$/, '');
  return a.startsWith(v + '/') ? a.slice(v.length + 1) : null;
}

/** `p` after moving `from` (a note or folder) to `to`. */
function relocatePath(p: string, from: string, to: string): string {
  if (p === from) return to;
  if (p.startsWith(from + '/')) return to + p.slice(from.length);
  return p;
}

function isNotFound(e: unknown): boolean {
  return typeof e === 'string' && e.includes('not_found');
}

// ── Image path helpers ────────────────────────────────────────────────────────

const IMAGE_RE = /!\[([^\]]*)\]\(([^)]+)\)/g;
const REMOTE_OR_ASSET_URL = /^(https?|tauri|asset):\/\//i;
const DATA_URL = /^data:/i;

export function normalizePosixPath(path: string): string {
  const isAbs = path.startsWith('/');
  const segments = path.split('/');
  const resolved: string[] = [];
  for (const seg of segments) {
    if (seg === '' || seg === '.') continue;
    if (seg === '..') {
      if (resolved.length > 0 && resolved[resolved.length - 1] !== '..') {
        resolved.pop();
      } else if (!isAbs) {
        resolved.push('..');
      }
    } else {
      resolved.push(seg);
    }
  }
  return (isAbs ? '/' : '') + resolved.join('/');
}

/** The `src` the editor shows for an image path typed/written in a note (remote URLs unchanged). */
export function resolveImageSrc(src: string, noteDir: string): string {
  const trimmed = src.trim();
  if (DATA_URL.test(trimmed) || REMOTE_OR_ASSET_URL.test(trimmed)) {
    return trimmed;
  }

  let normalized = trimmed.replace(/^\/\/+/, '/');
  try {
    normalized = decodeURI(normalized);
  } catch {
    // Keep as is if decodeURI fails
  }

  const isWinAbs = /^[a-zA-Z]:[/\\]/.test(normalized);
  const isAbs = normalized.startsWith('/') || isWinAbs;

  const unified = isAbs
    ? normalized.replace(/\\/g, '/')
    : noteDir.replace(/\\/g, '/') + '/' + normalized.replace(/\\/g, '/');

  const absPath = normalizePosixPath(unified);
  return convertAssetSrc(absPath);
}

export function processImagesOnLoad(markdown: string, noteDir: string): string {
  return markdown.replace(IMAGE_RE, (_match, alt: string, src: string) => {
    return `![${alt}](${resolveImageSrc(src, noteDir)})`;
  });
}

export function computeRelativePosixPath(fromDir: string, toPath: string): string {
  const normFrom = fromDir.replace(/\\/g, '/').replace(/\/+$/, '');
  const normTo = toPath.replace(/\\/g, '/');

  const fromParts = normFrom.split('/').filter(Boolean);
  const toParts = normTo.split('/').filter(Boolean);

  let common = 0;
  while (common < fromParts.length && common < toParts.length && fromParts[common] === toParts[common]) {
    common++;
  }

  if (common === 0) {
    return toPath;
  }

  const upCount = fromParts.length - common;
  const upSegments = Array(upCount).fill('..');
  const remainingTo = toParts.slice(common);

  const rel = [...upSegments, ...remainingTo].join('/');
  return rel || '.';
}

export function processImagesOnSave(markdown: string, noteDir: string): string {
  return markdown.replace(IMAGE_RE, (match, alt: string, src: string) => {
    const trimmed = src.trim();
    if (/^https?:\/\/(?!asset\.localhost)/i.test(trimmed) || /^data:/i.test(trimmed)) {
      return match;
    }

    let absPath: string | null = null;
    if (trimmed.startsWith('tauri://') || trimmed.startsWith('asset://') || trimmed.startsWith('http://asset.localhost')) {
      try {
        absPath = decodeURIComponent(new URL(trimmed).pathname);
      } catch {
        absPath = null;
      }
    } else if (trimmed.startsWith('//') || trimmed.startsWith('/')) {
      absPath = trimmed.replace(/^\/\/+/, '/');
    }

    if (!absPath) return match;

    const rel = computeRelativePosixPath(noteDir, absPath);
    return `![${alt}](${rel})`;
  });
}

// ── Store ─────────────────────────────────────────────────────────────────────

export const useEditorStore = create<EditorState>((set, get) => {
  function scheduleSave(): void {
    clearDebounce();
    debounceTimer = setTimeout(() => {
      get().saveNow().catch(console.error);
    }, SAVE_DEBOUNCE_MS);
  }

  /** Marks the buffer clean unless it changed while the write was in flight. */
  function markSaved(path: string, content: string): void {
    if (get().activeNoteContent === content && get().activeNotePath === path) {
      set({ saveStatus: 'saved', isDirty: false, lastSavedAt: Date.now() });
    }
  }

  /** Writes the buffer to its path, ignoring holds. Throws on a failed write. */
  async function writeBuffer(): Promise<void> {
    const { activeNotePath, activeNoteContent, vaultPath, saveBlockedPath } = get();
    if (!activeNotePath || activeNoteContent === null || !vaultPath) return;
    if (saveBlockedPath === activeNotePath) return; // would overwrite the remote version
    if (openCheckPath === activeNotePath) return; // checked against disk right now
    // A reopened note still waits for its remote-change check: writing now
    // could overwrite a peer's version without keeping it as a copy.
    if (openNoteNeedsCheck()) return;
    const noteDir = activeNotePath.substring(0, activeNotePath.lastIndexOf('/'));
    const out = processImagesOnSave(activeNoteContent, noteDir);
    await writeNote(activeNotePath, out, vaultPath);
    if (get().activeNotePath === activeNotePath) set({ diskContent: out });
    markSaved(activeNotePath, activeNoteContent);
    // Fire-and-forget: update embeddings after successful save (TC-35)
    if (activeNotePath.endsWith('.md')) {
      brainUpdateEmbedding(activeNotePath, vaultPath).catch(() => {});
    }
  }

  /** Keeps the open note's buffer for the release instead of writing it mid-cycle. */
  function deferActiveNote(): void {
    const { activeNotePath, activeNoteContent, vaultPath, saveBlockedPath, diskContent, deferredWrites } =
      get();
    if (!activeNotePath || activeNoteContent === null || !vaultPath) return;
    const blocked = saveBlockedPath === activeNotePath || deferredWrites[activeNotePath]?.blocked === true;
    set({
      deferredWrites: {
        ...deferredWrites,
        [activeNotePath]: { content: activeNoteContent, vault: vaultPath, base: diskContent, blocked },
      },
    });
  }

  function dropDeferred(path: string, entry: DeferredWrite): void {
    const current = get().deferredWrites;
    if (current[path] !== entry) return; // replaced meanwhile
    const rest = { ...current };
    delete rest[path];
    set({ deferredWrites: rest });
  }

  function blockDeferred(path: string, entry: DeferredWrite): void {
    const current = get().deferredWrites;
    if (current[path] !== entry) return;
    set({ deferredWrites: { ...current, [path]: { ...entry, blocked: true } } });
  }

  async function conflictCopyWithRetry(path: string, vault: string): Promise<string> {
    try {
      return await writeConflictCopy(path, vault);
    } catch {
      return await writeConflictCopy(path, vault);
    }
  }

  /**
   * Writes each deferred note under the rules of the open note: a note the
   * cycle changed (or may have changed) gets its disk version kept as a
   * conflict copy first; without that copy the path is never overwritten.
   */
  async function writeDeferred(changed: Set<string>, unknown: boolean): Promise<DeferredFlushResult> {
    const result = emptyFlushResult();
    for (const [path, entry] of Object.entries(get().deferredWrites)) {
      const rel = vaultRelative(path, entry.vault);
      if (rel === null) {
        dropDeferred(path, entry);
        continue;
      }
      let disk: string | null;
      try {
        disk = await readNote(path, entry.vault);
      } catch (e) {
        if (!isNotFound(e)) {
          console.error('reading a deferred note failed:', e);
          blockDeferred(path, entry);
          result.writeFailed = true;
          continue;
        }
        disk = null;
      }
      const out = processImagesOnSave(entry.content, path.substring(0, path.lastIndexOf('/')));
      try {
        if (disk === null) {
          // Edit wins over delete: recreate the note from the buffer.
          await chatWriteNote(rel, out, 'create', entry.vault);
        } else {
          const mayHaveChanged =
            entry.blocked || changed.has(rel) || (unknown && (entry.base === null || disk !== entry.base));
          if (mayHaveChanged && disk !== out) {
            let copy: string;
            try {
              copy = await conflictCopyWithRetry(path, entry.vault);
            } catch (e) {
              console.error('conflict copy of a deferred note failed twice:', e);
              blockDeferred(path, entry);
              result.failed = true;
              continue;
            }
            result.copies.push(copy);
          }
          await writeNote(path, out, entry.vault);
        }
      } catch (e) {
        // Any copy is already on disk; the buffer stays deferred.
        console.error('writing a deferred note failed:', e);
        result.writeFailed = true;
        continue;
      }
      result.written += 1;
      dropDeferred(path, entry);
      if (path.endsWith('.md')) brainUpdateEmbedding(path, entry.vault).catch(() => {});
    }
    return result;
  }

  /** The open note is the deferred note reopened during the hold that just ended. */
  function openNoteNeedsCheck(): boolean {
    const { activeNotePath, isDirty } = get();
    return reopenedDuringHold !== null && reopenedDuringHold.path === activeNotePath && isDirty;
  }

  /** Saves resume: the open note's pending save runs (after its check, if any). */
  function resumeOpenNote(): void {
    if (get().isDirty && !openNoteNeedsCheck()) scheduleSave();
  }

  /**
   * Before the open note's buffer may be written outside a hold (switch,
   * quit): let a rename/move finish, wait for a running check, and run a
   * still-pending check now. Without a cycle report the check compares the
   * disk with the note's base, so a changed disk is kept as a conflict copy.
   */
  async function settleOpenNote(): Promise<void> {
    while (relocationInFlight !== null && get().isDirty) await relocationInFlight;
    if (deferredFlush !== null) await deferredFlush;
    if (openNoteNeedsCheck() && get().saveHolds === 0) {
      releasedUnknown = true;
      await flushDeferred();
    }
  }

  /**
   * The deferred note reopened during the hold gets the deferred-entry rules:
   * when the cycle changed (or may have changed) it, the disk version is kept
   * as a conflict copy before the buffer is written; without it, never.
   */
  async function checkReopened(changed: Set<string>, unknown: boolean): Promise<DeferredFlushResult> {
    const result = emptyFlushResult();
    const reopened = reopenedDuringHold;
    if (reopened !== null && relocationInFlight !== null) {
      // A rename/move is about to give the open note its new path: check
      // the note once it has, with the same reported changes.
      const pending = relocationInFlight;
      changed.forEach((p) => releasedChanges.add(p));
      if (unknown) releasedUnknown = true;
      void pending.then(() => {
        if (get().saveHolds === 0) void flushDeferred();
      });
      return result;
    }
    reopenedDuringHold = null;
    const { activeNotePath: path, vaultPath, isDirty, saveBlockedPath } = get();
    if (reopened === null || reopened.path !== path || !isDirty || !vaultPath) return result;
    const rel = vaultRelative(path, vaultPath);
    const blocked = saveBlockedPath === path;
    // Without a report (`unknown`) the disk is checked against `base` below.
    const mayHaveChanged = rel !== null && (blocked || changed.has(rel) || unknown);
    if (!mayHaveChanged) {
      scheduleSave();
      return result;
    }
    clearDebounce();
    openCheckPath = path;
    try {
      let disk: string | null;
      try {
        disk = await readNote(path, vaultPath);
      } catch (e) {
        if (!isNotFound(e)) {
          console.error('reading the reopened note failed:', e);
          set({ saveBlockedPath: path });
          result.writeFailed = true;
          return result;
        }
        disk = null;
      }
      const buffer = get().activeNoteContent;
      if (get().activeNotePath !== path || buffer === null) return result;
      const out = processImagesOnSave(buffer, path.substring(0, path.lastIndexOf('/')));
      if (disk === null) {
        // Edit wins over delete: recreate the note from the buffer.
        await chatWriteNote(rel as string, out, 'create', vaultPath);
        if (get().activeNotePath === path) set({ diskContent: out, saveBlockedPath: null });
        markSaved(path, buffer);
        result.written += 1;
        return result;
      }
      const differs = blocked || changed.has(rel as string) || reopened.base === null || disk !== reopened.base;
      if (differs && disk !== out) {
        try {
          result.copies.push(await conflictCopyWithRetry(path, vaultPath));
        } catch (e) {
          console.error('conflict copy of the reopened note failed twice:', e);
          if (get().activeNotePath === path) set({ saveBlockedPath: path });
          result.failed = true;
          return result;
        }
      }
      if (get().activeNotePath !== path) return result;
      set({ saveBlockedPath: null });
      openCheckPath = null;
      await writeBuffer();
      result.written += 1;
    } catch (e) {
      console.error('saving the reopened note failed:', e);
      result.writeFailed = true;
    } finally {
      if (openCheckPath === path) openCheckPath = null;
    }
    return result;
  }

  /** Runs the deferred writes with the changes reported since the last run. */
  function flushDeferred(): Promise<DeferredFlushResult> {
    const changed = releasedChanges;
    const unknown = releasedUnknown;
    releasedChanges = new Set();
    releasedUnknown = false;
    if (
      Object.keys(get().deferredWrites).length === 0 &&
      deferredFlush === null &&
      reopenedDuringHold === null
    ) {
      return Promise.resolve(emptyFlushResult());
    }
    const previous = deferredFlush ?? Promise.resolve(null);
    const run: Promise<DeferredFlushResult> = previous
      .then(async () => {
        const open = await checkReopened(changed, unknown);
        const rest = await writeDeferred(changed, unknown);
        const result: DeferredFlushResult = {
          copies: [...open.copies, ...rest.copies],
          written: open.written + rest.written,
          failed: open.failed || rest.failed,
          writeFailed: open.writeFailed || rest.writeFailed,
        };
        if (result.copies.length > 0 || result.written > 0 || result.failed || result.writeFailed) {
          flushListeners.forEach((listener) => listener(result));
        }
        return result;
      })
      .finally(() => {
        if (deferredFlush === run) deferredFlush = null;
      });
    deferredFlush = run;
    return run;
  }

  /** Deferred writes (and a save block off the open note) follow a relocation. */
  function remapDeferred(from: string, to: string): void {
    const { deferredWrites, saveBlockedPath, activeNotePath } = get();
    if (Object.keys(deferredWrites).some((p) => relocatePath(p, from, to) !== p)) {
      set({
        deferredWrites: Object.fromEntries(
          Object.entries(deferredWrites).map(([p, entry]) => [relocatePath(p, from, to), entry]),
        ),
      });
    }
    // The open note's block moves with the note itself (`applyRelocation`):
    // moving it alone would unblock the note at its old path meanwhile.
    if (saveBlockedPath !== null && saveBlockedPath !== activeNotePath) {
      set({ saveBlockedPath: relocatePath(saveBlockedPath, from, to) });
    }
  }

  return {
  activeNotePath: null,
  activeNoteContent: null,
  vaultPath: null,
  vaultTree: [],
  saveStatus: 'idle',
  lastSavedAt: null,
  isDirty: false,
  selectionText: '',
  loadVersion: 0,
  focusTitleOnOpen: false,
  relocation: null,
  saveHolds: 0,
  lastConflictCopy: null,
  saveBlockedPath: null,
  deferredWrites: {},
  diskContent: null,
  editLocked: false,

  async openNote(absolutePath: string) {
    // Claim this call's slot. Any older in-flight openNote is stale and must
    // not overwrite the store once a newer request is already loading.
    const seq = ++openNoteSeq;
    // Never drop the previous note's pending edit. A rename/move is awaited
    // so the edit lands on the new path. During a sync hold the buffer is
    // deferred to the release: a write after the merge checkout would
    // overwrite the merged file. `writeBuffer` never writes a blocked note.
    if (deferredFlush !== null) await deferredFlush;
    clearDebounce();
    // A pending remote-change check runs before the buffer may be written.
    await settleOpenNote();
    clearDebounce();
    if (get().isDirty && get().activeNotePath !== null) {
      if (get().saveHolds > 0) {
        deferActiveNote();
      } else {
        try {
          await writeBuffer();
        } catch (e) {
          console.error('flush before switching notes failed:', e);
        }
        // Not on disk (blocked, check failed, write failed): keep it for the
        // next release instead of dropping it with the switch.
        if (get().isDirty) deferActiveNote();
      }
    }

    const { vaultPath } = get();
    if (!vaultPath) return;
    reopenedDuringHold = null;

    const deferred = get().deferredWrites[absolutePath];
    if (deferred !== undefined && deferred.vault === vaultPath) {
      // Back to a note still waiting for the release: its buffer becomes the
      // open note's again. While the hold lasts it keeps the deferred-entry
      // rules: at release it is checked against its disk content at deferral.
      dropDeferred(absolutePath, deferred);
      if (get().saveHolds > 0) reopenedDuringHold = { path: absolutePath, base: deferred.base };
      set({
        activeNotePath: absolutePath,
        activeNoteContent: deferred.content,
        diskContent: deferred.base,
        saveBlockedPath: deferred.blocked ? absolutePath : null,
        saveStatus: 'saving',
        lastSavedAt: null,
        isDirty: true,
        selectionText: '',
        loadVersion: get().loadVersion + 1,
      });
      scheduleSave();
      return;
    }

    let rawMarkdown: string;
    try {
      rawMarkdown = await readNote(absolutePath, vaultPath);
    } catch (e) {
      console.error('openNote: failed to read note:', absolutePath, e);
      // Keep URL and store in sync even on failure so the UI does not get
      // stuck (the editor will show an empty canvas; the user can retry by
      // clicking a different note and coming back).
      // Only apply if no newer openNote superseded this one while we awaited.
      if (seq === openNoteSeq) {
        set({
          activeNotePath: absolutePath,
          activeNoteContent: null,
          diskContent: null,
          saveBlockedPath: null,
          saveStatus: 'idle',
          lastSavedAt: null,
          isDirty: false,
          selectionText: '',
          loadVersion: get().loadVersion + 1,
        });
      }
      return;
    }

    // Only the last openNote call may write to the store. If a newer call
    // started and completed its own readNote while this one was reading,
    // silently discard our stale result.
    if (seq !== openNoteSeq) return;

    const noteDir = absolutePath.substring(0, absolutePath.lastIndexOf('/'));
    const processedMarkdown = processImagesOnLoad(rawMarkdown, noteDir);

    set({
      activeNotePath: absolutePath,
      activeNoteContent: processedMarkdown,
      diskContent: rawMarkdown,
      saveBlockedPath: null,
      saveStatus: 'idle',
      lastSavedAt: null,
      isDirty: false,
      selectionText: '',
      loadVersion: get().loadVersion + 1,
    });
  },

  setSelectionText(text: string) {
    set({ selectionText: text });
  },

  setContent(markdown: string) {
    set({ activeNoteContent: markdown, saveStatus: 'saving', isDirty: true });

    scheduleSave();
  },

  async saveNow() {
    if (get().saveHolds > 0) return; // releaseSaves reschedules once the hold ends
    if (!get().isDirty) return; // nothing to write: never rewrite a clean buffer over disk
    try {
      await writeBuffer();
    } catch (e) {
      console.error('saveNow failed:', e);
    }
  },

  async flushEdits() {
    await settleOpenNote();
    await get().saveNow();
  },

  setEditLocked(locked: boolean) {
    set({ editLocked: locked });
  },

  async initVault() {
    const vault = await getActiveVault();
    if (vault !== null) {
      const tree = await listVaultTree(vault);
      // A block belongs to a note of the previous vault.
      const switched = vault !== get().vaultPath;
      set({ vaultPath: vault, vaultTree: tree, ...(switched ? { saveBlockedPath: null } : {}) });
    }
  },

  async refreshVaultTree() {
    const { vaultPath } = get();
    if (!vaultPath) return;
    set({ vaultTree: await listVaultTree(vaultPath) });
  },

  async runRelocation<T>(
    run: () => Promise<T>,
    finish?: (result: T) => Promise<void>,
    moved?: (result: T) => { from: string; to: string } | null,
  ): Promise<T> {
    let settle: () => void = () => {};
    const tracker = new Promise<void>((resolve) => (settle = resolve));
    relocationInFlight = tracker;
    try {
      // Hold saves so nothing is written to a path that is going away.
      await get().holdSaves();
      let result: T;
      try {
        result = await run();
        // Before the release: it may flush the deferred writes right away.
        const move = moved?.(result) ?? null;
        if (move !== null) remapDeferred(move.from, move.to);
      } finally {
        void get().releaseSaves();
      }
      if (finish) await finish(result);
      return result;
    } finally {
      if (relocationInFlight === tracker) relocationInFlight = null;
      settle();
    }
  },

  async holdSaves() {
    clearDebounce();
    // Count the hold before flushing so a release arriving mid-flush is not
    // lost; the flush itself bypasses the hold.
    const holds = get().saveHolds + 1;
    set({ saveHolds: holds });
    if (holds === 1) {
      if (holdSafetyTimer !== null) clearTimeout(holdSafetyTimer);
      holdSafetyTimer = setTimeout(() => {
        holdSafetyTimer = null;
        if (get().saveHolds === 0) return;
        console.warn('Save hold exceeded 60 s; resuming saves');
        set({ saveHolds: 0 });
        // A cycle may still have changed the note on disk: check it like a
        // reopened note (against what the editor last read or wrote) before
        // writing, instead of saving blindly.
        const { activeNotePath, isDirty, diskContent } = get();
        if (isDirty && activeNotePath !== null && reopenedDuringHold?.path !== activeNotePath) {
          reopenedDuringHold = { path: activeNotePath, base: diskContent };
        }
        releasedUnknown = true;
        void flushDeferred();
      }, SAVE_HOLD_MAX_MS);
    }
    // Deferred writes from the previous release land before the next cycle.
    if (deferredFlush !== null) await deferredFlush;
    if (get().isDirty) {
      try {
        await writeBuffer();
      } catch (e) {
        console.error('flush before hold failed:', e);
      }
    }
  },

  releaseSaves(remote?: ReleaseRemote) {
    const none = Promise.resolve(emptyFlushResult());
    const holds = get().saveHolds;
    if (holds === 0) return none;
    if (remote === 'unknown') releasedUnknown = true;
    else remote?.forEach((p) => releasedChanges.add(p));
    set({ saveHolds: holds - 1 });
    if (holds > 1) return none;
    if (holdSafetyTimer !== null) {
      clearTimeout(holdSafetyTimer);
      holdSafetyTimer = null;
    }
    resumeOpenNote();
    return flushDeferred();
  },

  async applyRemoteChanges(changedPaths: string[], vaultPath: string) {
    set({ lastConflictCopy: null });
    const path = get().activeNotePath;
    if (!path) return 'none';
    const rel = vaultRelative(path, vaultPath);
    if (rel === null) return 'none';
    const retrying = get().saveBlockedPath === path;
    if (!retrying && !changedPaths.includes(rel)) return 'none';

    const block = (): RemoteChangeResult => {
      if (get().activeNotePath === path) set({ saveBlockedPath: path });
      return 'error';
    };
    let remote: string | null;
    try {
      remote = await readNote(path, vaultPath);
    } catch (e) {
      if (!isNotFound(e)) {
        console.error('reading the synced note failed:', e);
        return block();
      }
      remote = null;
    }
    // Everything below re-reads the store after each await: the user may
    // have typed or switched notes meanwhile. A switch evaluates the note
    // open now (it may be a deferred note reopened during the cycle).
    if (get().activeNotePath !== path) return get().applyRemoteChanges(changedPaths, vaultPath);
    // This note is settled here, not by the check at release.
    if (reopenedDuringHold?.path === path) reopenedDuringHold = null;
    const noteDir = path.substring(0, path.lastIndexOf('/'));

    if (remote === null) {
      const { isDirty, activeNoteContent } = get();
      if (!isDirty || activeNoteContent === null) {
        clearDebounce();
        set({
          activeNotePath: null,
          activeNoteContent: null,
          isDirty: false,
          saveStatus: 'idle',
          selectionText: '',
          saveBlockedPath: null,
        });
        return 'deleted';
      }
      // Edit wins over delete: recreate the note from the buffer.
      set({ saveBlockedPath: null });
      const out = processImagesOnSave(activeNoteContent, noteDir);
      await chatWriteNote(rel, out, 'create', vaultPath);
      if (get().activeNotePath === path) set({ diskContent: out });
      markSaved(path, activeNoteContent);
      return 'conflict';
    }

    if (!get().isDirty) {
      // Reload in place from what was just read (no second read, no await):
      // the editor keeps its instance and scroll position.
      set({
        activeNoteContent: processImagesOnLoad(remote, noteDir),
        diskContent: remote,
        isDirty: false,
        saveStatus: 'idle',
        saveBlockedPath: null,
        loadVersion: get().loadVersion + 1,
      });
      return 'reloaded';
    }

    // Local keeps the path; the remote version on disk becomes a conflict
    // copy first. Without the copy, the buffer must never overwrite it.
    let copy: string;
    try {
      copy = await writeConflictCopy(path, vaultPath);
    } catch {
      try {
        copy = await writeConflictCopy(path, vaultPath);
      } catch (e) {
        console.error('conflict copy failed twice:', e);
        return block();
      }
    }
    if (get().activeNotePath !== path) return 'none';
    set({ lastConflictCopy: copy, saveBlockedPath: null });
    await writeBuffer();
    return 'conflict';
  },

  async applyRelocation(from: string, to: string, rewritten: string[]) {
    const { activeNotePath, saveBlockedPath } = get();
    const relocate = (p: string | null): string | null => (p === null ? null : relocatePath(p, from, to));
    const mapped = relocate(activeNotePath);
    // A save block follows its note.
    if (saveBlockedPath !== null) set({ saveBlockedPath: relocate(saveBlockedPath) });
    // Idempotent: `runRelocation` may have remapped these already.
    remapDeferred(from, to);
    if (reopenedDuringHold !== null) {
      reopenedDuringHold = { ...reopenedDuringHold, path: relocatePath(reopenedDuringHold.path, from, to) };
    }
    if (mapped !== activeNotePath) {
      set({ activeNotePath: mapped, relocation: { from: activeNotePath as string, to: mapped as string } });
    }
    await get().refreshVaultTree();
    if (mapped && !get().isDirty && rewritten.includes(mapped)) {
      await get().openNote(mapped);
    }
  },
};
});
