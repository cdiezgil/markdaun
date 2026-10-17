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
  /** Plain text currently selected in the editor ('' when none). */
  selectionText: string;

  // Actions
  openNote(absolutePath: string): Promise<void>;
  setContent(markdown: string): void;
  setSelectionText(text: string): void;
  saveNow(): Promise<void>;
  initVault(): Promise<void>;
}

// ── Internal debounce ref (module-level, not in store state) ───────────────────

let debounceTimer: ReturnType<typeof setTimeout> | null = null;

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

function processImagesOnSave(markdown: string, noteDir: string): string {
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
  selectionText: '',

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
      selectionText: '',
    });
  },

  setSelectionText(text: string) {
    set({ selectionText: text });
  },

  setContent(markdown: string) {
    set({ activeNoteContent: markdown, saveStatus: 'saving' });

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

    const noteDir = activeNotePath.substring(0, activeNotePath.lastIndexOf('/'));
    const processedMarkdown = processImagesOnSave(activeNoteContent, noteDir);

    try {
      await writeNote(activeNotePath, processedMarkdown, vaultPath);
      set({ saveStatus: 'saved' });
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
}));
