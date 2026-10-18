import { create } from 'zustand';
import { inboxDiscard, inboxList, type InboxItem } from '../lib/tauri';

interface InboxState {
  items: InboxItem[];
  /** Vault-relative paths of the selected items. */
  selected: string[];
  loading: boolean;
  error: string | null;

  load(vaultPath: string): Promise<void>;
  toggle(relPath: string): void;
  selectAll(): void;
  clearSelection(): void;
  discard(item: InboxItem, vaultPath: string): Promise<void>;
}

export const useInboxStore = create<InboxState>((set, get) => ({
  items: [],
  selected: [],
  loading: false,
  error: null,

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
    if (!item?.supported) return;
    const { selected } = get();
    set({
      selected: selected.includes(relPath) ? selected.filter((p) => p !== relPath) : [...selected, relPath],
    });
  },

  selectAll() {
    set({ selected: get().items.filter((i) => i.supported).map((i) => i.rel_path) });
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
}));
