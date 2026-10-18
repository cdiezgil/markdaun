import { create } from 'zustand';
import {
  readNote,
  writeNote,
  getActiveVault,
  listVaultTree,
  convertAssetSrc,
  brainUpdateEmbedding,
  type VaultEntry,
} from '../lib/tauri';

// ── Types ──────────────────────────────────────────────────────────────────────

export type SaveStatus = 'idle' | 'saving' | 'saved';

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

  // Actions
  openNote(absolutePath: string): Promise<void>;
  setContent(markdown: string): void;
  setSelectionText(text: string): void;
  saveNow(): Promise<void>;
  initVault(): Promise<void>;
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
}

// ── Internal debounce ref (module-level, not in store state) ───────────────────

let debounceTimer: ReturnType<typeof setTimeout> | null = null;
/** True while a rename/move runs: saves are deferred to avoid writing to the old path. */
let relocating = false;

// ── Image path helpers ────────────────────────────────────────────────────────

const IMAGE_RE = /!\[([^\]]*)\]\(([^)]+)\)/g;

function processImagesOnLoad(markdown: string, noteDir: string): string {
  return markdown.replace(IMAGE_RE, (match, alt: string, src: string) => {
    if (/^(https?|tauri):\/\//.test(src)) return match;
    try {
      const absPath = new URL(src, 'file://' + noteDir + '/').pathname;
      return `![${alt}](${convertAssetSrc(absPath)})`;
    } catch {
      return match;
    }
  });
}

export function processImagesOnSave(markdown: string, noteDir: string): string {
  return markdown.replace(IMAGE_RE, (match, alt: string, src: string) => {
    if (!src.startsWith('tauri://') && !src.startsWith('asset://')) return match;
    try {
      // Both tauri:// (production) and asset:// (test mock) paths
      const absPath = decodeURIComponent(new URL(src).pathname);
      // Compute relative path from noteDir
      const notePrefix = noteDir.endsWith('/') ? noteDir : noteDir + '/';
      const rel = absPath.startsWith(notePrefix)
        ? absPath.slice(notePrefix.length)
        : absPath;
      return `![${alt}](${rel})`;
    } catch {
      return match;
    }
  });
}

// ── Store ─────────────────────────────────────────────────────────────────────

export const useEditorStore = create<EditorState>((set, get) => ({
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

  async openNote(absolutePath: string) {
    // Cancel any pending debounced save for the previous note
    if (debounceTimer !== null) {
      clearTimeout(debounceTimer);
      debounceTimer = null;
    }

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

    if (debounceTimer !== null) {
      clearTimeout(debounceTimer);
    }
    debounceTimer = setTimeout(() => {
      get().saveNow().catch(console.error);
    }, 1000);
  },

  async saveNow() {
    const { activeNotePath, activeNoteContent, vaultPath } = get();
    if (!activeNotePath || activeNoteContent === null || !vaultPath) return;
    if (relocating) return; // runRelocation reschedules once the new path is known

    const noteDir = activeNotePath.substring(0, activeNotePath.lastIndexOf('/'));
    const processedMarkdown = processImagesOnSave(activeNoteContent, noteDir);

    try {
      await writeNote(activeNotePath, processedMarkdown, vaultPath);
      // Edits made while the write was in flight keep the note dirty.
      if (get().activeNoteContent === activeNoteContent && get().activeNotePath === activeNotePath) {
        set({ saveStatus: 'saved', isDirty: false, lastSavedAt: Date.now() });
      }
      // Fire-and-forget: update embeddings after successful save (TC-35)
      if (activeNotePath.endsWith('.md')) {
        brainUpdateEmbedding(activeNotePath, vaultPath).catch(() => {});
      }
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

  async runRelocation<T>(run: () => Promise<T>): Promise<T> {
    if (debounceTimer !== null) {
      clearTimeout(debounceTimer);
      debounceTimer = null;
    }
    if (get().isDirty) await get().saveNow();
    relocating = true;
    try {
      return await run();
    } finally {
      relocating = false;
      if (get().isDirty) {
        debounceTimer = setTimeout(() => {
          get().saveNow().catch(console.error);
        }, 1000);
      }
    }
  },

  async applyRelocation(from: string, to: string, rewritten: string[]) {
    const { activeNotePath, vaultPath } = get();
    let mapped = activeNotePath;
    if (activeNotePath === from) mapped = to;
    else if (activeNotePath?.startsWith(from + '/')) mapped = to + activeNotePath.slice(from.length);
    if (mapped !== activeNotePath) {
      set({ activeNotePath: mapped, relocation: { from: activeNotePath as string, to: mapped as string } });
    }
    if (vaultPath) {
      const tree = await listVaultTree(vaultPath);
      set({ vaultTree: tree });
    }
    if (mapped && !get().isDirty && rewritten.includes(mapped)) {
      await get().openNote(mapped);
    }
  },
}));
