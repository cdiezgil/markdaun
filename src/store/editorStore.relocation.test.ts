import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import { useEditorStore } from './editorStore';

const mockInvoke = vi.mocked(invoke);

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  useEditorStore.setState({
    activeNotePath: '/vault/Sin título.md',
    activeNoteContent: '# Idea',
    vaultPath: '/vault',
    vaultTree: [],
    saveStatus: 'idle',
    isDirty: false,
    loadVersion: 3,
    relocation: null,
  });
});

afterEach(() => {
  vi.useRealTimers();
});

describe('applyRelocation', () => {
  it('moves the active path without reloading content or touching unsaved edits', async () => {
    useEditorStore.setState({ activeNoteContent: '# Idea\n\nmás', isDirty: true });
    mockInvoke.mockResolvedValue([]); // list_vault_tree

    await useEditorStore.getState().applyRelocation('/vault/Sin título.md', '/vault/Idea.md', []);

    const s = useEditorStore.getState();
    expect(s.activeNotePath).toBe('/vault/Idea.md');
    expect(s.activeNoteContent).toBe('# Idea\n\nmás');
    expect(s.isDirty).toBe(true);
    expect(s.loadVersion).toBe(3);
    expect(s.relocation).toEqual({ from: '/vault/Sin título.md', to: '/vault/Idea.md' });
    expect(mockInvoke).toHaveBeenCalledWith('list_vault_tree', { vaultPath: '/vault' });
    expect(mockInvoke).not.toHaveBeenCalledWith('read_note', expect.anything());
  });

  it('remaps the active note when its folder moved', async () => {
    useEditorStore.setState({ activeNotePath: '/vault/proj/a/N.md' });
    mockInvoke.mockResolvedValue([]);
    await useEditorStore.getState().applyRelocation('/vault/proj', '/vault/arch/proj', []);
    expect(useEditorStore.getState().activeNotePath).toBe('/vault/arch/proj/a/N.md');
  });

  it('ignores relocations of other notes but still refreshes the tree', async () => {
    mockInvoke.mockResolvedValue([]);
    await useEditorStore.getState().applyRelocation('/vault/otra.md', '/vault/otra2.md', []);
    const s = useEditorStore.getState();
    expect(s.activeNotePath).toBe('/vault/Sin título.md');
    expect(s.relocation).toBeNull();
    expect(mockInvoke).toHaveBeenCalledWith('list_vault_tree', { vaultPath: '/vault' });
  });

  it('reloads a clean active note whose links were rewritten on disk', async () => {
    mockInvoke.mockImplementation(async (cmd: string) => (cmd === 'read_note' ? '# Idea [[Nuevo]]' : []));
    await useEditorStore
      .getState()
      .applyRelocation('/vault/otra.md', '/vault/Nuevo.md', ['/vault/Sin título.md']);
    const s = useEditorStore.getState();
    expect(s.activeNoteContent).toBe('# Idea [[Nuevo]]');
    expect(s.loadVersion).toBe(4);
  });

  it('does not reload a dirty active note', async () => {
    useEditorStore.setState({ isDirty: true });
    mockInvoke.mockResolvedValue([]);
    await useEditorStore
      .getState()
      .applyRelocation('/vault/otra.md', '/vault/Nuevo.md', ['/vault/Sin título.md']);
    expect(useEditorStore.getState().loadVersion).toBe(3);
    expect(mockInvoke).not.toHaveBeenCalledWith('read_note', expect.anything());
  });
});

describe('runRelocation', () => {
  it('flushes pending edits before running and passes the result through', async () => {
    mockInvoke.mockResolvedValue(undefined);
    useEditorStore.getState().setContent('# Idea\n\nnuevo');
    const result = await useEditorStore.getState().runRelocation(async () => {
      expect(mockInvoke).toHaveBeenCalledWith('write_note', {
        path: '/vault/Sin título.md',
        content: '# Idea\n\nnuevo',
        vaultPath: '/vault',
      });
      return 42;
    });
    expect(result).toBe(42);
  });

  it('does not write to the old path while the relocation is in flight, and saves afterwards', async () => {
    mockInvoke.mockResolvedValue(undefined);
    await useEditorStore.getState().runRelocation(async () => {
      useEditorStore.getState().setContent('# Idea\n\ntecleado durante el renombrado');
      await vi.advanceTimersByTimeAsync(1500);
      expect(mockInvoke).not.toHaveBeenCalledWith('write_note', expect.anything());
      useEditorStore.setState({ activeNotePath: '/vault/Idea.md' });
    });
    await vi.advanceTimersByTimeAsync(1000);
    expect(mockInvoke).toHaveBeenCalledWith('write_note', {
      path: '/vault/Idea.md',
      content: '# Idea\n\ntecleado durante el renombrado',
      vaultPath: '/vault',
    });
  });
});

describe('openNote', () => {
  it('bumps loadVersion so the editor reloads the content', async () => {
    mockInvoke.mockResolvedValueOnce('# Otra');
    await useEditorStore.getState().openNote('/vault/otra.md');
    expect(useEditorStore.getState().loadVersion).toBe(4);
  });
});
