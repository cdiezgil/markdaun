import { create } from 'zustand';
import { open as openDialog } from '@tauri-apps/plugin-dialog';
import {
  inboxClipUrl,
  inboxDiscard,
  inboxGetLastArea,
  inboxImportFiles,
  inboxList,
  inboxListAreas,
  officeImport,
  voiceRetry,
  inboxSetLastArea,
  type ClipSummary,
  type InboxItem,
} from '../lib/tauri';
import { isBatchable } from '../lib/inbox';
import { useVaultStore } from './vaultStore';

interface InboxState {
  items: InboxItem[];
  /** Vault-relative paths of the selected items. */
  selected: string[];
  loading: boolean;
  /** A URL is being clipped. */
  clipping: boolean;
  /** A .docx or .pptx is being imported. */
  importing: boolean;
  error: string | null;
  /** Digestion areas (top-level folders) of the vault. */
  areas: string[];
  /** Area of the previous digestion ('' = vault root); null if none yet. */
  lastArea: string | null;

  loadAreas(vaultPath: string): Promise<void>;
  /** Transcribes a recording again after a failure. */
  retryVoice(item: InboxItem, vaultPath: string): Promise<void>;
  rememberArea(vaultPath: string, area: string): Promise<void>;
  load(vaultPath: string): Promise<void>;
  toggle(relPath: string): void;
  selectAll(): void;
  clearSelection(): void;
  discard(item: InboxItem, vaultPath: string): Promise<void>;
  /** Clips a web page into the inbox; null (with `error` set) when the URL is invalid. */
  clipUrl(url: string, vaultPath: string): Promise<ClipSummary | null>;
  /** Opens the native file picker and copies the chosen files into Entrada/. */
  pickFiles(vaultPath: string): Promise<void>;
  /** Imports a .docx or .pptx by splitting it into notes. Returns stem and note count on success. */
  importOffice(item: InboxItem, vaultPath: string): Promise<{ stem: string; count: number } | null>;
}

export const useInboxStore = create<InboxState>((set, get) => ({
  items: [],
  selected: [],
  loading: false,
  clipping: false,
  importing: false,
  error: null,
  areas: [],
  lastArea: null,

  async loadAreas(vaultPath) {
    try {
      const [areas, lastArea] = await Promise.all([inboxListAreas(vaultPath), inboxGetLastArea(vaultPath)]);
      set({ areas, lastArea: lastArea ?? null });
    } catch (e) {
      set({ error: String(e) });
    }
  },

  async retryVoice(item, vaultPath) {
    try {
      await voiceRetry(vaultPath, item.rel_path);
      await get().load(vaultPath);
    } catch (e) {
      set({ error: String(e) });
    }
  },

  async rememberArea(vaultPath, area) {
    set({ lastArea: area });
    try {
      await inboxSetLastArea(vaultPath, area);
    } catch {
      /* remembering the area is a convenience */
    }
  },

  async load(vaultPath) {
    set({ loading: true });
    try {
      const items = await inboxList(vaultPath);
      const present = new Set(items.map((i) => i.rel_path));
      set({ items, selected: get().selected.filter((p) => present.has(p)), loading: false, error: null });
    } catch (e) {
      set({ error: String(e), loading: false });
    }
  },

  toggle(relPath) {
    const item = get().items.find((i) => i.rel_path === relPath);
    if (!item || !isBatchable(item)) return;
    const { selected } = get();
    set({
      selected: selected.includes(relPath) ? selected.filter((p) => p !== relPath) : [...selected, relPath],
    });
  },

  selectAll() {
    set({ selected: get().items.filter(isBatchable).map((i) => i.rel_path) });
  },

  clearSelection() {
    set({ selected: [] });
  },

  async discard(item, vaultPath) {
    try {
      await inboxDiscard(item.path, vaultPath);
      set({
        items: get().items.filter((i) => i.rel_path !== item.rel_path),
        selected: get().selected.filter((p) => p !== item.rel_path),
        error: null,
      });
    } catch (e) {
      set({ error: String(e) });
    }
  },

  async clipUrl(url, vaultPath) {
    set({ clipping: true, error: null });
    try {
      const summary = await inboxClipUrl(url, vaultPath);
      await get().load(vaultPath);
      set({ clipping: false });
      return summary;
    } catch (e) {
      set({ clipping: false, error: String(e) });
      return null;
    }
  },

  async importOffice(item, vaultPath) {
    set({ importing: true, error: null });
    try {
      const result = await officeImport(item.path, vaultPath);
      const stem = item.name.replace(/\.(docx|pptx)$/i, '');
      // Count section notes (exclude índice.md which is always the last entry).
      const count = result.notes.filter((n) => !n.endsWith('índice.md')).length;
      await get().load(vaultPath);
      // Refresh the vault tree so the new Entrada/<stem>/ directory becomes
      // visible to the user without requiring a manual navigation.
      await useVaultStore.getState().refreshTree();
      set({ importing: false });
      return { stem, count };
    } catch (e) {
      set({ importing: false, error: String(e) });
      return null;
    }
  },

  async pickFiles(vaultPath) {
    const picked = await openDialog({
      multiple: true,
      filters: [
        { name: 'Documentos e imágenes', extensions: ['pdf', 'docx', 'pptx', 'txt', 'md', 'png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'] },
        { name: 'Todos los archivos', extensions: ['*'] },
      ],
    });
    if (!picked) return;
    const paths = Array.isArray(picked) ? picked : [picked];
    if (paths.length === 0) return;
    try {
      await inboxImportFiles(vaultPath, paths);
      await get().load(vaultPath);
    } catch (e) {
      set({ error: String(e) });
    }
  },
}));
