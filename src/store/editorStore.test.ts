import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import { useEditorStore } from './editorStore';

const mockInvoke = vi.mocked(invoke);

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();

  // Reset store to initial state before each test
  useEditorStore.setState({
    activeNotePath: null,
    activeNoteContent: null,
    vaultPath: '/vault',
    vaultTree: [],
    saveStatus: 'idle',
  });
});

afterEach(() => {
  vi.useRealTimers();
});

// ── TC-01: openNote loads content ─────────────────────────────────────────────
describe('TC-01: openNote', () => {
  it('TC-01: loads note content and sets saveStatus to idle', async () => {
    mockInvoke.mockResolvedValueOnce('# Hola\n\nContenido');

    await useEditorStore.getState().openNote('/vault/note.md');

    const { activeNotePath, activeNoteContent, saveStatus } = useEditorStore.getState();
    expect(activeNotePath).toBe('/vault/note.md');
    expect(activeNoteContent).toBe('# Hola\n\nContenido');
    expect(saveStatus).toBe('idle');
    expect(mockInvoke).toHaveBeenCalledWith('read_note', {
      path: '/vault/note.md',
      vaultPath: '/vault',
    });
  });
});

// ── TC-02: setContent triggers debounced save ─────────────────────────────────
describe('TC-02: setContent debounce', () => {
  it('TC-02: calls writeNote exactly once after 1000ms', async () => {
    // Set up initial state
    useEditorStore.setState({
      activeNotePath: '/vault/note.md',
      activeNoteContent: '# Original',
      vaultPath: '/vault',
      saveStatus: 'idle',
    });

    mockInvoke.mockResolvedValue(undefined);

    useEditorStore.getState().setContent('# Editado');
    expect(mockInvoke).not.toHaveBeenCalledWith('write_note', expect.anything());

    await vi.advanceTimersByTimeAsync(1000);

    expect(mockInvoke).toHaveBeenCalledWith('write_note', {
      path: '/vault/note.md',
      content: '# Editado',
      vaultPath: '/vault',
    });
    // TC-35: brain_update_embedding is also called (fire-and-forget) for .md files
    expect(mockInvoke).toHaveBeenCalledWith('brain_update_embedding', {
      file_path: '/vault/note.md',
      vault_path: '/vault',
    });
  });

  it('TC-02: debounce resets when setContent called multiple times', async () => {
    useEditorStore.setState({
      activeNotePath: '/vault/note.md',
      activeNoteContent: '# Original',
      vaultPath: '/vault',
      saveStatus: 'idle',
    });

    mockInvoke.mockResolvedValue(undefined);

    useEditorStore.getState().setContent('# Draft 1');
    await vi.advanceTimersByTimeAsync(500);

    useEditorStore.getState().setContent('# Draft 2');
    await vi.advanceTimersByTimeAsync(500);

    // Not yet triggered (second call reset the timer)
    expect(mockInvoke).not.toHaveBeenCalledWith('write_note', expect.anything());

    await vi.advanceTimersByTimeAsync(500);

    expect(mockInvoke).toHaveBeenCalledWith('write_note', {
      path: '/vault/note.md',
      content: '# Draft 2',
      vaultPath: '/vault',
    });
  });
});

// ── TC-03: saveStatus transitions idle → saving → saved ──────────────────────
describe('TC-03: saveStatus transitions', () => {
  it('TC-03: saveStatus goes idle → saving → saved after debounce', async () => {
    useEditorStore.setState({
      activeNotePath: '/vault/note.md',
      activeNoteContent: '# Texto',
      vaultPath: '/vault',
      saveStatus: 'idle',
    });

    mockInvoke.mockResolvedValue(undefined);

    useEditorStore.getState().setContent('# Cambiado');
    expect(useEditorStore.getState().saveStatus).toBe('saving');

    await vi.advanceTimersByTimeAsync(1000);

    expect(useEditorStore.getState().saveStatus).toBe('saved');
  });
});

// ── TC-21: openNote cancels pending debounce ──────────────────────────────────
describe('TC-21: openNote cancels debounce', () => {
  it('TC-21: opening a second note cancels debounce from first note', async () => {
    useEditorStore.setState({
      activeNotePath: '/vault/nota-a.md',
      activeNoteContent: '# A',
      vaultPath: '/vault',
      saveStatus: 'idle',
    });

    // Pending write for nota-a
    useEditorStore.getState().setContent('# A modificada');
    expect(useEditorStore.getState().saveStatus).toBe('saving');

    // Open nota-b before the debounce fires
    mockInvoke.mockResolvedValueOnce('# B contenido');
    await useEditorStore.getState().openNote('/vault/nota-b.md');

    // Advance timers — the previous debounce should be cancelled
    mockInvoke.mockResolvedValue(undefined);
    await vi.advanceTimersByTimeAsync(1000);

    expect(useEditorStore.getState().activeNotePath).toBe('/vault/nota-b.md');

    // write_note should NOT have been called for nota-a
    const writeCalls = mockInvoke.mock.calls.filter(
      (c) => c[0] === 'write_note' && (c[1] as Record<string, unknown>)?.path === '/vault/nota-a.md',
    );
    expect(writeCalls).toHaveLength(0);
  });
});

// ── initVault ─────────────────────────────────────────────────────────────────
describe('initVault', () => {
  it('loads vaultPath and vaultTree from backend', async () => {
    useEditorStore.setState({ vaultPath: null, vaultTree: [] });

    const tree = [
      { name: 'note.md', path: '/vault/note.md', kind: 'file', file_type: 'md', children: null },
    ];
    mockInvoke
      .mockResolvedValueOnce('/home/user/vault') // get_active_vault
      .mockResolvedValueOnce(tree);              // list_vault_tree

    await useEditorStore.getState().initVault();

    expect(useEditorStore.getState().vaultPath).toBe('/home/user/vault');
    expect(useEditorStore.getState().vaultTree).toEqual(tree);
  });

  it('does nothing when no vault configured', async () => {
    useEditorStore.setState({ vaultPath: null, vaultTree: [] });
    mockInvoke.mockResolvedValueOnce(null);

    await useEditorStore.getState().initVault();

    expect(useEditorStore.getState().vaultPath).toBeNull();
    expect(useEditorStore.getState().vaultTree).toEqual([]);
  });
});
