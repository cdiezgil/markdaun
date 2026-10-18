import { describe, it, expect, vi, beforeEach } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import { useVaultStore } from './vaultStore';
import { useEditorStore } from './editorStore';

const mockInvoke = vi.mocked(invoke);

beforeEach(() => {
  vi.clearAllMocks();
  useVaultStore.setState({ vaultPath: '/vault', tree: [], isLoading: false, error: null, selectedFolder: null });
  useEditorStore.setState({
    activeNotePath: '/vault/Old.md',
    activeNoteContent: '# Old',
    vaultPath: '/vault',
    vaultTree: [],
    isDirty: false,
    loadVersion: 1,
    relocation: null,
    focusTitleOnOpen: false,
  });
  mockInvoke.mockImplementation(async (cmd: string) => {
    if (cmd === 'rename_entry') return { path: '/vault/New.md', rewritten: [] };
    if (cmd === 'move_entry') return { path: '/vault/dest/Old.md', rewritten: [] };
    if (cmd === 'create_untitled_note') return '/vault/dir/Sin título.md';
    if (cmd === 'list_vault_tree') return [];
    return undefined;
  });
});

describe('createUntitledNote', () => {
  it('creates in the selected folder, refreshes the tree and asks the editor to focus the title', async () => {
    useVaultStore.setState({ selectedFolder: '/vault/dir' });
    const path = await useVaultStore.getState().createUntitledNote();
    expect(path).toBe('/vault/dir/Sin título.md');
    expect(mockInvoke).toHaveBeenCalledWith('create_untitled_note', {
      parentPath: '/vault/dir',
      vaultPath: '/vault',
    });
    expect(mockInvoke).toHaveBeenCalledWith('list_vault_tree', { vaultPath: '/vault' });
    expect(useEditorStore.getState().focusTitleOnOpen).toBe(true);
  });

  it('falls back to the vault root without a selection', async () => {
    await useVaultStore.getState().createUntitledNote();
    expect(mockInvoke).toHaveBeenCalledWith('create_untitled_note', {
      parentPath: '/vault',
      vaultPath: '/vault',
    });
  });

  it('an explicit parent wins over the selection', async () => {
    useVaultStore.setState({ selectedFolder: '/vault/dir' });
    await useVaultStore.getState().createUntitledNote('/vault/otra');
    expect(mockInvoke).toHaveBeenCalledWith('create_untitled_note', {
      parentPath: '/vault/otra',
      vaultPath: '/vault',
    });
  });
});

describe('selectedFolder', () => {
  it('selectFolder stores it and selecting a note selects its folder (root = null)', () => {
    useVaultStore.getState().selectFolder('/vault/dir');
    expect(useVaultStore.getState().selectedFolder).toBe('/vault/dir');
    useVaultStore.getState().selectNoteLocation('/vault/dir/sub/n.md');
    expect(useVaultStore.getState().selectedFolder).toBe('/vault/dir/sub');
    useVaultStore.getState().selectNoteLocation('/vault/n.md');
    expect(useVaultStore.getState().selectedFolder).toBeNull();
  });

  it('is cleared when the selected folder is renamed or moved', async () => {
    useVaultStore.setState({ selectedFolder: '/vault/dir/sub' });
    await useVaultStore.getState().renameEntry('/vault/dir', 'x');
    expect(useVaultStore.getState().selectedFolder).toBeNull();
  });
});

describe('renameEntry / moveEntry', () => {
  it('rename moves the active note to its new path', async () => {
    await useVaultStore.getState().renameEntry('/vault/Old.md', 'New.md');
    expect(mockInvoke).toHaveBeenCalledWith('rename_entry', {
      path: '/vault/Old.md',
      newName: 'New.md',
      vaultPath: '/vault',
    });
    expect(useEditorStore.getState().activeNotePath).toBe('/vault/New.md');
    expect(useEditorStore.getState().activeNoteContent).toBe('# Old');
  });

  it('move updates the active note path too', async () => {
    await useVaultStore.getState().moveEntry('/vault/Old.md', '/vault/dest');
    expect(useEditorStore.getState().activeNotePath).toBe('/vault/dest/Old.md');
  });

  it('flushes unsaved edits to the old path before renaming', async () => {
    useEditorStore.setState({ activeNoteContent: '# Old\n\nedit', isDirty: true });
    await useVaultStore.getState().renameEntry('/vault/Old.md', 'New.md');
    const order = mockInvoke.mock.calls.map((c) => c[0]);
    expect(order.indexOf('write_note')).toBeGreaterThanOrEqual(0);
    expect(order.indexOf('write_note')).toBeLessThan(order.indexOf('rename_entry'));
  });
});
