import { create } from 'zustand';
import { invoke } from '@tauri-apps/api/core';
import { useEditorStore } from './editorStore';

export interface VaultEntry {
  name: string;
  path: string;
  kind: 'file' | 'folder';
  file_type?: 'md' | 'image' | 'pdf' | 'other';
  children?: VaultEntry[];
}

interface VaultState {
  vaultPath: string | null;
  tree: VaultEntry[];
  isLoading: boolean;
  error: string | null;
  /** Folder new notes are created in (null = vault root). */
  selectedFolder: string | null;
  selectFolder(path: string | null): void;
  /** A note was clicked: its folder becomes the selected one. */
  selectNoteLocation(notePath: string): void;
  /** Creates `Sin título.md` without asking; returns its path. */
  createUntitledNote(parentPath?: string): Promise<string>;
  openVault(): Promise<void>;
  loadVault(): Promise<void>;
  refreshTree(): Promise<void>;
  createNote(parentPath: string, name: string): Promise<void>;
  createFolder(parentPath: string, name: string): Promise<void>;
  renameEntry(path: string, newName: string): Promise<void>;
  deleteEntry(path: string): Promise<void>;
  moveEntry(sourcePath: string, destFolderPath: string): Promise<void>;
  importFileData(destFolderPath: string, fileName: string, contents: Uint8Array): Promise<void>;
}

interface MoveOutcome {
  path: string;
  rewritten: string[];
}

/** Forgets the selected folder when it lives under a renamed/moved entry. */
function clearSelectionUnder(
  path: string,
  set: (partial: Partial<VaultState>) => void,
  get: () => VaultState,
) {
  const sel = get().selectedFolder;
  if (sel && (sel === path || sel.startsWith(path + '/'))) set({ selectedFolder: null });
}

export const useVaultStore = create<VaultState>((set, get) => ({
  vaultPath: null,
  tree: [],
  isLoading: false,
  error: null,
  selectedFolder: null,

  selectFolder(path) {
    set({ selectedFolder: path });
  },

  selectNoteLocation(notePath) {
    const { vaultPath } = get();
    const dir = notePath.substring(0, notePath.lastIndexOf('/'));
    set({ selectedFolder: !dir || dir === vaultPath ? null : dir });
  },

  async createUntitledNote(parentPath) {
    const { vaultPath, selectedFolder } = get();
    set({ error: null });
    try {
      const path = await invoke<string>('create_untitled_note', {
        parentPath: parentPath ?? selectedFolder ?? vaultPath,
        vaultPath,
      });
      useEditorStore.setState({ focusTitleOnOpen: true });
      await get().refreshTree();
      await useEditorStore.getState().refreshVaultTree();
      return path;
    } catch (e) {
      set({ error: typeof e === 'string' ? e : String(e) });
      throw e;
    }
  },

  async openVault() {
    set({ error: null });
    try {
      const result = await invoke<string | null>('open_vault_dialog');
      if (result !== null) {
        set({ vaultPath: result });
        await get().refreshTree();
      }
    } catch (e) {
      set({ error: typeof e === 'string' ? e : String(e) });
    }
  },

  async loadVault() {
    set({ error: null });
    try {
      const path = await invoke<string | null>('get_active_vault');
      if (path !== null) {
        set({ vaultPath: path });
        await get().refreshTree();
      }
    } catch (e) {
      set({ error: typeof e === 'string' ? e : String(e) });
    }
  },

  async refreshTree() {
    const { vaultPath } = get();
    if (!vaultPath) return;
    set({ isLoading: true, error: null });
    try {
      const tree = await invoke<VaultEntry[]>('list_vault_tree', {
        vaultPath: vaultPath,
      });
      set({ tree, isLoading: false });
    } catch (e) {
      set({ error: typeof e === 'string' ? e : String(e), isLoading: false });
    }
  },

  async createNote(parentPath: string, name: string) {
    const { vaultPath } = get();
    set({ error: null });
    try {
      await invoke<string>('create_note', {
        parentPath: parentPath,
        name,
        vaultPath: vaultPath,
      });
      await get().refreshTree();
    } catch (e) {
      set({ error: typeof e === 'string' ? e : String(e) });
      throw e;
    }
  },

  async createFolder(parentPath: string, name: string) {
    const { vaultPath } = get();
    set({ error: null });
    try {
      await invoke<string>('create_folder', {
        parentPath: parentPath,
        name,
        vaultPath: vaultPath,
      });
      await get().refreshTree();
    } catch (e) {
      set({ error: typeof e === 'string' ? e : String(e) });
      throw e;
    }
  },

  async renameEntry(path: string, newName: string) {
    const { vaultPath } = get();
    set({ error: null });
    try {
      const out = await useEditorStore.getState().runRelocation(() =>
        invoke<MoveOutcome>('rename_entry', { path, newName: newName, vaultPath: vaultPath }),
      );
      clearSelectionUnder(path, set, get);
      await get().refreshTree();
      if (out) await useEditorStore.getState().applyRelocation(path, out.path, out.rewritten ?? []);
    } catch (e) {
      set({ error: typeof e === 'string' ? e : String(e) });
      throw e;
    }
  },

  async deleteEntry(path: string) {
    const { vaultPath } = get();
    set({ error: null });
    try {
      await invoke<void>('delete_entry', {
        path,
        vaultPath: vaultPath,
      });
      await get().refreshTree();
    } catch (e) {
      set({ error: typeof e === 'string' ? e : String(e) });
      throw e;
    }
  },

  async moveEntry(sourcePath: string, destFolderPath: string) {
    const { vaultPath } = get();
    set({ error: null });
    try {
      const out = await useEditorStore.getState().runRelocation(() =>
        invoke<MoveOutcome>('move_entry', {
          sourcePath: sourcePath,
          destFolderPath: destFolderPath,
          vaultPath: vaultPath,
        }),
      );
      clearSelectionUnder(sourcePath, set, get);
      await get().refreshTree();
      if (out) await useEditorStore.getState().applyRelocation(sourcePath, out.path, out.rewritten ?? []);
    } catch (e) {
      set({ error: typeof e === 'string' ? e : String(e) });
      throw e;
    }
  },

  async importFileData(destFolderPath: string, fileName: string, contents: Uint8Array) {
    const { vaultPath } = get();
    set({ error: null });
    try {
      await invoke<string>('import_file_data', {
        destFolderPath: destFolderPath,
        fileName: fileName,
        contents: Array.from(contents),
        vaultPath: vaultPath,
      });
      await get().refreshTree();
    } catch (e) {
      set({ error: typeof e === 'string' ? e : String(e) });
      throw e;
    }
  },
}));
