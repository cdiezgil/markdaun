import { create } from 'zustand';
import { invoke } from '@tauri-apps/api/core';

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
  openVault(): Promise<void>;
  loadVault(): Promise<void>;
  refreshTree(): Promise<void>;
  createNote(parentPath: string, name: string): Promise<void>;
  createFolder(parentPath: string, name: string): Promise<void>;
  renameEntry(path: string, newName: string): Promise<void>;
  deleteEntry(path: string): Promise<void>;
  moveEntry(sourcePath: string, destFolderPath: string): Promise<void>;
  importFiles(destFolderPath: string, sourcePaths: string[]): Promise<void>;
}

export const useVaultStore = create<VaultState>((set, get) => ({
  vaultPath: null,
  tree: [],
  isLoading: false,
  error: null,

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
        vault_path: vaultPath,
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
        parent_path: parentPath,
        name,
        vault_path: vaultPath,
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
        parent_path: parentPath,
        name,
        vault_path: vaultPath,
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
      await invoke<string>('rename_entry', {
        path,
        new_name: newName,
        vault_path: vaultPath,
      });
      await get().refreshTree();
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
        vault_path: vaultPath,
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
      await invoke<string>('move_entry', {
        sourcePath: sourcePath,
        destFolderPath: destFolderPath,
        vaultPath: vaultPath,
      });
      await get().refreshTree();
    } catch (e) {
      set({ error: typeof e === 'string' ? e : String(e) });
      throw e;
    }
  },

  async importFiles(destFolderPath: string, sourcePaths: string[]) {
    const { vaultPath } = get();
    set({ error: null });
    try {
      await invoke<string[]>('import_files', {
        dest_folder_path: destFolderPath,
        source_paths: sourcePaths,
        vault_path: vaultPath,
      });
      await get().refreshTree();
    } catch (e) {
      set({ error: typeof e === 'string' ? e : String(e) });
      throw e;
    }
  },
}));
