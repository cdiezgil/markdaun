import { create } from 'zustand';
import {
  ideOpenFolderDialog,
  ideListTree,
  ideReadFile,
  ideWriteFile,
  ideCreateFile,
  ideCreateFolder,
  ideRenameEntry,
  ideDeleteEntry,
  ideGetProjects,
  ideSaveProjects,
  type VaultEntry,
} from '../lib/tauri';

// ── Types ──────────────────────────────────────────────────────────────────────

export interface IdeProject {
  rootPath: string;
  /** basename of rootPath */
  name: string;
  tree: VaultEntry[];
}

export type SaveStatus = 'idle' | 'saving' | 'saved';

export interface IdeState {
  projects: IdeProject[];
  /** Absolute path of the active file in the IDE editor (null = none). */
  activeFilePath: string | null;
  /** Markdown content of the active file. */
  activeFileContent: string | null;
  saveStatus: SaveStatus;
  isDirty: boolean;
  lastSavedAt: number | null;
  loadVersion: number;

  // Actions
  loadProjects(): Promise<void>;
  addProject(path: string): Promise<void>;
  removeProject(rootPath: string): Promise<void>;
  refreshTree(rootPath: string): Promise<void>;
  openFile(path: string): Promise<void>;
  setContent(markdown: string): void;
  saveNow(): Promise<void>;
  createFile(parentPath: string, name: string): Promise<string>;
  createFolder(parentPath: string, name: string): Promise<string>;
  renameEntry(path: string, newName: string): Promise<string>;
  deleteEntry(path: string): Promise<void>;
}

// ── Debounce ref ───────────────────────────────────────────────────────────────

let debounceTimer: ReturnType<typeof setTimeout> | null = null;

// ── Helpers ────────────────────────────────────────────────────────────────────

function basename(p: string): string {
  return p.replace(/\\/g, '/').split('/').filter(Boolean).pop() ?? p;
}

// ── Store ─────────────────────────────────────────────────────────────────────

export const useIdeStore = create<IdeState>((set, get) => ({
  projects: [],
  activeFilePath: null,
  activeFileContent: null,
  saveStatus: 'idle',
  isDirty: false,
  lastSavedAt: null,
  loadVersion: 0,

  async loadProjects() {
    const paths = await ideGetProjects();
    const projects: IdeProject[] = await Promise.all(
      paths.map(async (rootPath) => {
        let tree: VaultEntry[] = [];
        try {
          tree = await ideListTree(rootPath);
        } catch {
          // If the directory no longer exists, show empty tree.
        }
        return { rootPath, name: basename(rootPath), tree };
      }),
    );
    set({ projects });
  },

  async addProject(path: string) {
    const tree = await ideListTree(path);
    const project: IdeProject = { rootPath: path, name: basename(path), tree };
    const projects = [...get().projects, project];
    set({ projects });
    await ideSaveProjects(projects.map((p) => p.rootPath));
  },

  async removeProject(rootPath: string) {
    const projects = get().projects.filter((p) => p.rootPath !== rootPath);
    set({ projects });
    await ideSaveProjects(projects.map((p) => p.rootPath));

    // If the active file belonged to this project, clear the editor.
    const { activeFilePath } = get();
    if (activeFilePath?.startsWith(rootPath)) {
      if (debounceTimer !== null) {
        clearTimeout(debounceTimer);
        debounceTimer = null;
      }
      set({ activeFilePath: null, activeFileContent: null, saveStatus: 'idle', isDirty: false });
    }
  },

  async refreshTree(rootPath: string) {
    const tree = await ideListTree(rootPath);
    set({
      projects: get().projects.map((p) =>
        p.rootPath === rootPath ? { ...p, tree } : p,
      ),
    });
  },

  async openFile(path: string) {
    // Cancel pending debounced save for previous file
    if (debounceTimer !== null) {
      clearTimeout(debounceTimer);
      debounceTimer = null;
    }
    const content = await ideReadFile(path);
    set({
      activeFilePath: path,
      activeFileContent: content,
      saveStatus: 'idle',
      isDirty: false,
      lastSavedAt: null,
      loadVersion: get().loadVersion + 1,
    });
  },

  setContent(markdown: string) {
    set({ activeFileContent: markdown, saveStatus: 'saving', isDirty: true });
    if (debounceTimer !== null) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      get().saveNow().catch(console.error);
    }, 1000);
  },

  async saveNow() {
    const { activeFilePath, activeFileContent } = get();
    if (!activeFilePath || activeFileContent === null) return;
    try {
      await ideWriteFile(activeFilePath, activeFileContent);
      if (
        get().activeFilePath === activeFilePath &&
        get().activeFileContent === activeFileContent
      ) {
        set({ saveStatus: 'saved', isDirty: false, lastSavedAt: Date.now() });
      }
    } catch (e) {
      console.error('IDE saveNow failed:', e);
    }
  },

  async createFile(parentPath: string, name: string): Promise<string> {
    const newPath = await ideCreateFile(parentPath, name);
    // Refresh the tree of the project that owns parentPath
    const project = get().projects.find((p) => parentPath.startsWith(p.rootPath));
    if (project) await get().refreshTree(project.rootPath);
    return newPath;
  },

  async createFolder(parentPath: string, name: string): Promise<string> {
    const newPath = await ideCreateFolder(parentPath, name);
    const project = get().projects.find((p) => parentPath.startsWith(p.rootPath));
    if (project) await get().refreshTree(project.rootPath);
    return newPath;
  },

  async renameEntry(path: string, newName: string): Promise<string> {
    const newPath = await ideRenameEntry(path, newName);
    // Update active path if the renamed entry was open
    const { activeFilePath } = get();
    if (activeFilePath === path) {
      set({ activeFilePath: newPath });
    } else if (activeFilePath?.startsWith(path + '/')) {
      set({ activeFilePath: newPath + activeFilePath.slice(path.length) });
    }
    // Refresh tree
    const project = get().projects.find((p) => path.startsWith(p.rootPath));
    if (project) await get().refreshTree(project.rootPath);
    return newPath;
  },

  async deleteEntry(path: string): Promise<void> {
    await ideDeleteEntry(path);
    // Clear editor if the deleted entry was active
    const { activeFilePath } = get();
    if (activeFilePath && (activeFilePath === path || activeFilePath.startsWith(path + '/'))) {
      if (debounceTimer !== null) {
        clearTimeout(debounceTimer);
        debounceTimer = null;
      }
      set({ activeFilePath: null, activeFileContent: null, saveStatus: 'idle', isDirty: false });
    }
    // Refresh tree
    const project = get().projects.find((p) => path.startsWith(p.rootPath));
    if (project) await get().refreshTree(project.rootPath);
  },
}));

/** Opens the OS folder picker, adds the selected folder as an IDE project, and returns its path. */
export async function idePickAndAddProject(): Promise<string | null> {
  const path = await ideOpenFolderDialog();
  if (!path) return null;
  await useIdeStore.getState().addProject(path);
  return path;
}
