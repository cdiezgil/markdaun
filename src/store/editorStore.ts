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
export type RemoteChangeResult = 'none' | 'reloaded' | 'conflict' | 'deleted';

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

  // Actions
  openNote(absolutePath: string): Promise<void>;
  setContent(markdown: string): void;
  setSelectionText(text: string): void;
  saveNow(): Promise<void>;
  initVault(): Promise<void>;
  /** Reloads the tree the editor resolves wikilinks against. */
  refreshVaultTree(): Promise<void>;
  /**
   * Runs a rename/move: pending edits are flushed first and saves are held
   * back while it runs, so nothing is written to a path that is going away.
   */
  runRelocation<T>(run: () => Promise<T>): Promise<T>;
  /**
   * `from` (a note or folder) now lives at `to`. Keeps the active note's
   * unsaved content and cursor, refreshes the tree, and reloads the active
   * note when `rewritten` shows links in it changed on disk.
   */
  applyRelocation(from: string, to: string, rewritten: string[]): Promise<void>;
  /** Flush the pending debounced save, then hold saves until `releaseSaves`. */
  holdSaves(): Promise<void>;
  /** End one hold; the deferred save runs when the last hold ends. */
  releaseSaves(): void;
  /**
   * A sync cycle changed `changedPaths` (vault-relative). Reloads, closes or
   * keeps the open note; unsaved edits always win and the remote version is
   * kept as a conflict copy. Writes the buffer even while saves are held.
   */
  applyRemoteChanges(changedPaths: string[], vaultPath: string): Promise<RemoteChangeResult>;
}

// ── Internal debounce ref (module-level, not in store state) ───────────────────

let debounceTimer: ReturnType<typeof setTimeout> | null = null;
/** Forces a stuck hold off: a lost release event must never keep typing unsaved. */
let holdSafetyTimer: ReturnType<typeof setTimeout> | null = null;

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
    const { activeNotePath, activeNoteContent, vaultPath } = get();
    if (!activeNotePath || activeNoteContent === null || !vaultPath) return;
    const noteDir = activeNotePath.substring(0, activeNotePath.lastIndexOf('/'));
    await writeNote(activeNotePath, processImagesOnSave(activeNoteContent, noteDir), vaultPath);
    markSaved(activeNotePath, activeNoteContent);
    // Fire-and-forget: update embeddings after successful save (TC-35)
    if (activeNotePath.endsWith('.md')) {
      brainUpdateEmbedding(activeNotePath, vaultPath).catch(() => {});
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

  async openNote(absolutePath: string) {
    // Cancel any pending debounced save for the previous note
    clearDebounce();

    const { vaultPath } = get();
    if (!vaultPath) return;

    const rawMarkdown = await readNote(absolutePath, vaultPath);

    const noteDir = absolutePath.substring(0, absolutePath.lastIndexOf('/'));
    const processedMarkdown = processImagesOnLoad(rawMarkdown, noteDir);

    set({
      activeNotePath: absolutePath,
      activeNoteContent: processedMarkdown,
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
    try {
      await writeBuffer();
    } catch (e) {
      console.error('saveNow failed:', e);
    }
  },

  async initVault() {
    const vault = await getActiveVault();
    if (vault !== null) {
      const tree = await listVaultTree(vault);
      set({ vaultPath: vault, vaultTree: tree });
    }
  },

  async refreshVaultTree() {
    const { vaultPath } = get();
    if (!vaultPath) return;
    set({ vaultTree: await listVaultTree(vaultPath) });
  },

  async runRelocation<T>(run: () => Promise<T>): Promise<T> {
    // Hold saves so nothing is written to a path that is going away.
    await get().holdSaves();
    try {
      return await run();
    } finally {
      get().releaseSaves();
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
        if (get().isDirty) scheduleSave();
      }, SAVE_HOLD_MAX_MS);
    }
    if (get().isDirty) {
      try {
        await writeBuffer();
      } catch (e) {
        console.error('flush before hold failed:', e);
      }
    }
  },

  releaseSaves() {
    const holds = get().saveHolds;
    if (holds === 0) return;
    set({ saveHolds: holds - 1 });
    if (holds > 1) return;
    if (holdSafetyTimer !== null) {
      clearTimeout(holdSafetyTimer);
      holdSafetyTimer = null;
    }
    if (get().isDirty) scheduleSave();
  },

  async applyRemoteChanges(changedPaths: string[], vaultPath: string) {
    set({ lastConflictCopy: null });
    const { activeNotePath } = get();
    if (!activeNotePath) return 'none';
    const rel = vaultRelative(activeNotePath, vaultPath);
    if (rel === null || !changedPaths.includes(rel)) return 'none';

    let deleted = false;
    try {
      await readNote(activeNotePath, vaultPath);
    } catch (e) {
      if (!isNotFound(e)) throw e;
      deleted = true;
    }
    // Read after the await: the user may have typed meanwhile.
    const { isDirty, activeNoteContent } = get();
    const buffer = isDirty ? activeNoteContent : null;

    if (deleted) {
      if (buffer === null) {
        clearDebounce();
        set({
          activeNotePath: null,
          activeNoteContent: null,
          isDirty: false,
          saveStatus: 'idle',
          selectionText: '',
        });
        return 'deleted';
      }
      // Edit wins over delete: recreate the note from the buffer.
      const noteDir = activeNotePath.substring(0, activeNotePath.lastIndexOf('/'));
      await chatWriteNote(rel, processImagesOnSave(buffer, noteDir), 'create', vaultPath);
      markSaved(activeNotePath, buffer);
      return 'conflict';
    }
    if (buffer === null) {
      await get().openNote(activeNotePath);
      return 'reloaded';
    }
    // Local keeps the path; the remote version on disk becomes a conflict copy.
    const copy = await writeConflictCopy(activeNotePath, vaultPath);
    set({ lastConflictCopy: copy });
    await writeBuffer();
    return 'conflict';
  },

  async applyRelocation(from: string, to: string, rewritten: string[]) {
    const { activeNotePath } = get();
    let mapped = activeNotePath;
    if (activeNotePath === from) mapped = to;
    else if (activeNotePath?.startsWith(from + '/')) mapped = to + activeNotePath.slice(from.length);
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
