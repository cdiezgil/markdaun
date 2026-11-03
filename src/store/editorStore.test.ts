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
      filePath: '/vault/note.md',
      vaultPath: '/vault',
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
  it('TC-21: opening a second note flushes the first note once and cancels its debounce', async () => {
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
    mockInvoke.mockImplementation(async (cmd: string) =>
      cmd === 'read_note' ? '# B contenido' : undefined,
    );
    await useEditorStore.getState().openNote('/vault/nota-b.md');

    // Advance timers — the previous debounce must not fire again
    await vi.advanceTimersByTimeAsync(1000);

    expect(useEditorStore.getState().activeNotePath).toBe('/vault/nota-b.md');
    expect(useEditorStore.getState().activeNoteContent).toBe('# B contenido');

    const writes = mockInvoke.mock.calls.filter((c) => c[0] === 'write_note');
    // nota-a's pending edit is flushed exactly once; nota-b is never written.
    expect(writes).toHaveLength(1);
    expect(writes[0][1]).toEqual({ path: '/vault/nota-a.md', content: '# A modificada', vaultPath: '/vault' });
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

// ── isDirty: unsaved edits signal ─────────────────────────────────────────────
describe('isDirty', () => {
  const seedNote = () =>
    useEditorStore.setState({
      activeNotePath: '/vault/note.md',
      activeNoteContent: '# A',
      vaultPath: '/vault',
      saveStatus: 'idle',
      isDirty: false,
    });

  it('is false after opening a note', async () => {
    mockInvoke.mockResolvedValueOnce('# Hola');
    await useEditorStore.getState().openNote('/vault/note.md');
    expect(useEditorStore.getState().isDirty).toBe(false);
  });

  it('becomes true on edit and false once the save succeeds', async () => {
    seedNote();
    mockInvoke.mockResolvedValue(undefined);
    useEditorStore.getState().setContent('# B');
    expect(useEditorStore.getState().isDirty).toBe(true);
    await vi.advanceTimersByTimeAsync(1000);
    expect(useEditorStore.getState().isDirty).toBe(false);
  });

  it('stays true when the save fails', async () => {
    seedNote();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    mockInvoke.mockRejectedValue('io_error');
    useEditorStore.getState().setContent('# B');
    await vi.advanceTimersByTimeAsync(1000);
    expect(useEditorStore.getState().isDirty).toBe(true);
  });

  it('stays true when the user edits while a save is in flight', async () => {
    seedNote();
    let release: () => void = () => {};
    mockInvoke.mockImplementation((() => new Promise<void>((r) => { release = r; })) as never);
    useEditorStore.getState().setContent('# B');
    await vi.advanceTimersByTimeAsync(1000); // save starts, write pending
    useEditorStore.getState().setContent('# C');
    release();
    await vi.advanceTimersByTimeAsync(0);
    expect(useEditorStore.getState().isDirty).toBe(true);
    expect(useEditorStore.getState().saveStatus).toBe('saving');
  });
});

// ── openNote: race-condition and error-recovery ────────────────────────────────
describe('openNote: concurrent calls and error recovery', () => {
  it('only the last openNote call wins when two are in flight concurrently', async () => {
    // openNote(A) starts first but resolves AFTER openNote(B).
    // The store must reflect B (the latest request), never A.
    let resolveA!: (v: string) => void;
    const readA = new Promise<string>((r) => (resolveA = r));
    let resolveB!: (v: string) => void;
    const readB = new Promise<string>((r) => (resolveB = r));

    mockInvoke
      .mockImplementationOnce(() => readA)   // first call → note A
      .mockImplementationOnce(() => readB);  // second call → note B

    const openA = useEditorStore.getState().openNote('/vault/a.md');
    const openB = useEditorStore.getState().openNote('/vault/b.md');

    // B resolves first, then A.
    resolveB('# B content');
    resolveA('# A content');
    await Promise.all([openA, openB]);

    const s = useEditorStore.getState();
    // Only the last caller (B) should have written to the store.
    expect(s.activeNotePath).toBe('/vault/b.md');
    expect(s.activeNoteContent).toBe('# B content');
  });

  it('when the later openNote starts after the earlier one already finished, last caller still wins', async () => {
    // openNote(A) finishes, THEN openNote(B) is called and finishes.
    mockInvoke
      .mockResolvedValueOnce('# A content')
      .mockResolvedValueOnce('# B content');

    await useEditorStore.getState().openNote('/vault/a.md');
    await useEditorStore.getState().openNote('/vault/b.md');

    const s = useEditorStore.getState();
    expect(s.activeNotePath).toBe('/vault/b.md');
    expect(s.activeNoteContent).toBe('# B content');
  });

  it('keeps URL and store in sync when readNote fails: sets activeNotePath to the requested path', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    mockInvoke.mockRejectedValueOnce('io_error: permission denied');

    await useEditorStore.getState().openNote('/vault/broken.md');

    const s = useEditorStore.getState();
    // activeNotePath must match the requested path so the UI does not diverge.
    expect(s.activeNotePath).toBe('/vault/broken.md');
    // Content is null (error state; editor renders the empty canvas).
    expect(s.activeNoteContent).toBeNull();
    // Not dirty: no edits to save.
    expect(s.isDirty).toBe(false);
  });

  it('a stale openNote that started before a newer one does not overwrite the result', async () => {
    // Stale call: resolves late. Fresh call: resolves first.
    let resolveStale!: (v: string) => void;
    const readStale = new Promise<string>((r) => (resolveStale = r));

    mockInvoke
      .mockImplementationOnce(() => readStale)  // stale call (started first)
      .mockResolvedValueOnce('# Fresh');         // fresh call (started second)

    const stale = useEditorStore.getState().openNote('/vault/stale.md');
    // Fresh call starts WHILE stale is still reading from disk.
    await useEditorStore.getState().openNote('/vault/fresh.md');
    // Now let the stale call resolve.
    resolveStale('# Stale');
    await stale;

    const s = useEditorStore.getState();
    // Fresh call won; stale result must be discarded.
    expect(s.activeNotePath).toBe('/vault/fresh.md');
    expect(s.activeNoteContent).toBe('# Fresh');
  });
});
