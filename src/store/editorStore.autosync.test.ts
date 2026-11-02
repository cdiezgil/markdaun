import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import { useEditorStore } from './editorStore';
import { useVaultStore } from './vaultStore';

const mockInvoke = vi.mocked(invoke);
const NOTE = '/vault/proj/Idea.md';
const COPY = 'proj/Idea (conflicto 2026-11-02 10-30).md';

/** Routes invoke calls by command; unknown commands resolve to undefined. */
function routeInvoke(handlers: Record<string, (args: unknown) => unknown>) {
  mockInvoke.mockImplementation(async (cmd: string, args?: unknown) => {
    const h = handlers[cmd];
    return h ? h(args) : undefined;
  });
}

function calledCommands(): string[] {
  return mockInvoke.mock.calls.map((c) => c[0] as string);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  useEditorStore.setState({
    activeNotePath: NOTE,
    activeNoteContent: '# Idea',
    vaultPath: '/vault',
    vaultTree: [],
    saveStatus: 'idle',
    isDirty: false,
    loadVersion: 3,
    relocation: null,
    saveHolds: 0,
    lastConflictCopy: null,
    saveBlockedPath: null,
    deferredWrites: {},
    diskContent: '# Idea',
  });
});

afterEach(() => {
  vi.useRealTimers();
});

describe('applyRemoteChanges', () => {
  it('reloads clean open note', async () => {
    routeInvoke({ read_note: () => '# Remota' });

    const result = await useEditorStore.getState().applyRemoteChanges(['proj/Idea.md'], '/vault');

    expect(result).toBe('reloaded');
    const s = useEditorStore.getState();
    expect(s.activeNoteContent).toBe('# Remota');
    expect(s.activeNotePath).toBe(NOTE);
    expect(s.isDirty).toBe(false);
    expect(s.loadVersion).toBe(4);
    expect(calledCommands()).not.toContain('write_note');
    expect(calledCommands().filter((c) => c === 'read_note')).toHaveLength(1);
  });

  it('keystroke during reload is kept (goes to conflict branch)', async () => {
    routeInvoke({
      read_note: () => {
        // The user types while the remote version is being read.
        useEditorStore.getState().setContent('# Idea\n\ntecla');
        return '# Remota';
      },
      write_conflict_copy: () => COPY,
    });

    const result = await useEditorStore.getState().applyRemoteChanges(['proj/Idea.md'], '/vault');

    expect(result).toBe('conflict');
    expect(mockInvoke).toHaveBeenCalledWith('write_note', {
      path: NOTE,
      content: '# Idea\n\ntecla',
      vaultPath: '/vault',
    });
    expect(useEditorStore.getState().activeNoteContent).toBe('# Idea\n\ntecla');
    expect(useEditorStore.getState().loadVersion).toBe(3);
  });

  it('retries a failed conflict copy once', async () => {
    useEditorStore.setState({ activeNoteContent: '# Idea\n\ntecleado', isDirty: true });
    let attempts = 0;
    routeInvoke({
      read_note: () => '# Remota',
      write_conflict_copy: () => {
        attempts += 1;
        if (attempts === 1) throw 'io_error: busy';
        return COPY;
      },
    });
    const result = await useEditorStore.getState().applyRemoteChanges(['proj/Idea.md'], '/vault');
    expect(result).toBe('conflict');
    expect(attempts).toBe(2);
    expect(calledCommands()).toContain('write_note');
  });

  it('never writes the buffer over the merged remote when the copy keeps failing', async () => {
    useEditorStore.setState({ activeNoteContent: '# Idea\n\ntecleado', isDirty: true });
    routeInvoke({
      read_note: () => '# Remota',
      write_conflict_copy: () => {
        throw 'io_error: disk full';
      },
    });

    const result = await useEditorStore.getState().applyRemoteChanges(['proj/Idea.md'], '/vault');

    expect(result).toBe('error');
    expect(useEditorStore.getState().saveBlockedPath).toBe(NOTE);
    // Neither a release, a later keystroke nor an explicit save may write it.
    useEditorStore.getState().setContent('# Idea\n\ntecleado más');
    await vi.advanceTimersByTimeAsync(5000);
    await useEditorStore.getState().saveNow();
    await useEditorStore.getState().holdSaves();
    useEditorStore.getState().releaseSaves();
    await vi.advanceTimersByTimeAsync(5000);
    expect(calledCommands()).not.toContain('write_note');
    expect(useEditorStore.getState().isDirty).toBe(true);
    expect(useEditorStore.getState().activeNoteContent).toBe('# Idea\n\ntecleado más');
  });

  it('retries copy-then-save on the next cycle even if the note did not change again', async () => {
    useEditorStore.setState({ activeNoteContent: '# Idea\n\ntecleado', isDirty: true, saveBlockedPath: NOTE });
    routeInvoke({ read_note: () => '# Remota', write_conflict_copy: () => COPY });

    const result = await useEditorStore.getState().applyRemoteChanges([], '/vault');

    expect(result).toBe('conflict');
    const cmds = calledCommands();
    expect(cmds.indexOf('write_conflict_copy')).toBeLessThan(cmds.indexOf('write_note'));
    expect(useEditorStore.getState().saveBlockedPath).toBeNull();
    expect(useEditorStore.getState().isDirty).toBe(false);
  });

  it('blocks saves when reading the note fails for another reason', async () => {
    useEditorStore.setState({ activeNoteContent: '# Idea\n\ntecleado', isDirty: true });
    routeInvoke({
      read_note: () => {
        throw 'io_error: permission denied';
      },
    });

    const result = await useEditorStore.getState().applyRemoteChanges(['proj/Idea.md'], '/vault');

    expect(result).toBe('error');
    expect(useEditorStore.getState().saveBlockedPath).toBe(NOTE);
    await useEditorStore.getState().saveNow();
    expect(calledCommands()).not.toContain('write_note');
    expect(calledCommands()).not.toContain('write_conflict_copy');
  });

  it('opening another note lifts the block', async () => {
    useEditorStore.setState({ saveBlockedPath: NOTE });
    routeInvoke({ read_note: () => '# Otra' });
    await useEditorStore.getState().openNote('/vault/otra.md');
    expect(useEditorStore.getState().saveBlockedPath).toBeNull();
  });

  it('returns none when the open note is not among the changed paths', async () => {
    routeInvoke({ read_note: () => '# Remota' });
    const result = await useEditorStore.getState().applyRemoteChanges(['otra.md'], '/vault');
    expect(result).toBe('none');
    expect(mockInvoke).not.toHaveBeenCalled();
    expect(useEditorStore.getState().loadVersion).toBe(3);
  });

  it('returns none when no note is open', async () => {
    useEditorStore.setState({ activeNotePath: null, activeNoteContent: null });
    const result = await useEditorStore.getState().applyRemoteChanges(['proj/Idea.md'], '/vault');
    expect(result).toBe('none');
  });

  it('keeps typed buffer and writes remote as conflict copy', async () => {
    useEditorStore.setState({ activeNoteContent: '# Idea\n\ntecleado', isDirty: true });
    routeInvoke({
      read_note: () => '# Remota',
      write_conflict_copy: () => COPY,
    });

    const result = await useEditorStore.getState().applyRemoteChanges(['proj/Idea.md'], '/vault');

    expect(result).toBe('conflict');
    expect(mockInvoke).toHaveBeenCalledWith('write_conflict_copy', { path: NOTE, vaultPath: '/vault' });
    expect(mockInvoke).toHaveBeenCalledWith('write_note', {
      path: NOTE,
      content: '# Idea\n\ntecleado',
      vaultPath: '/vault',
    });
    const cmds = calledCommands();
    expect(cmds.indexOf('write_conflict_copy')).toBeLessThan(cmds.indexOf('write_note'));
    const s = useEditorStore.getState();
    expect(s.activeNoteContent).toBe('# Idea\n\ntecleado');
    expect(s.isDirty).toBe(false);
    expect(s.loadVersion).toBe(3);
    expect(s.lastConflictCopy).toBe(COPY);
  });

  it('saves the buffer even while saves are held for the cycle', async () => {
    useEditorStore.setState({ activeNoteContent: '# Idea\n\ntecleado', isDirty: true, saveHolds: 1 });
    routeInvoke({ read_note: () => '# Remota', write_conflict_copy: () => COPY });
    await useEditorStore.getState().applyRemoteChanges(['proj/Idea.md'], '/vault');
    expect(calledCommands()).toContain('write_note');
  });

  it('closes clean note deleted remotely', async () => {
    routeInvoke({
      read_note: () => {
        throw 'path_not_found';
      },
    });

    const result = await useEditorStore.getState().applyRemoteChanges(['proj/Idea.md'], '/vault');

    expect(result).toBe('deleted');
    const s = useEditorStore.getState();
    expect(s.activeNotePath).toBeNull();
    expect(s.activeNoteContent).toBeNull();
    expect(s.isDirty).toBe(false);
  });

  it('recreates a dirty note deleted remotely (edit wins over delete)', async () => {
    useEditorStore.setState({ activeNoteContent: '# Idea\n\ntecleado', isDirty: true });
    routeInvoke({
      read_note: () => {
        throw 'path_not_found';
      },
      chat_write_note: () => NOTE,
    });

    const result = await useEditorStore.getState().applyRemoteChanges(['proj/Idea.md'], '/vault');

    expect(result).toBe('conflict');
    expect(mockInvoke).toHaveBeenCalledWith('chat_write_note', {
      path: 'proj/Idea.md',
      content: '# Idea\n\ntecleado',
      mode: 'create',
      vaultPath: '/vault',
    });
    expect(calledCommands()).not.toContain('write_conflict_copy');
    const s = useEditorStore.getState();
    expect(s.activeNotePath).toBe(NOTE);
    expect(s.isDirty).toBe(false);
    expect(s.lastConflictCopy).toBeNull();
  });
});

describe('save hold', () => {
  it('holdSaves flushes pending debounce before resolving', async () => {
    routeInvoke({});
    useEditorStore.getState().setContent('# Idea\n\nantes');

    await useEditorStore.getState().holdSaves();

    expect(mockInvoke).toHaveBeenCalledWith('write_note', {
      path: NOTE,
      content: '# Idea\n\nantes',
      vaultPath: '/vault',
    });
    expect(useEditorStore.getState().saveHolds).toBe(1);
  });

  it('defers saves typed while held and runs them on release', async () => {
    routeInvoke({});
    await useEditorStore.getState().holdSaves();
    useEditorStore.getState().setContent('# Idea\n\ndurante');
    await vi.advanceTimersByTimeAsync(5000);
    expect(calledCommands()).not.toContain('write_note');
    expect(useEditorStore.getState().isDirty).toBe(true);
    expect(useEditorStore.getState().activeNoteContent).toBe('# Idea\n\ndurante');

    useEditorStore.getState().releaseSaves();
    await vi.advanceTimersByTimeAsync(1000);
    expect(mockInvoke).toHaveBeenCalledWith('write_note', {
      path: NOTE,
      content: '# Idea\n\ndurante',
      vaultPath: '/vault',
    });
  });

  it('is a counter: one release does not end an overlapping hold', async () => {
    routeInvoke({});
    await useEditorStore.getState().holdSaves();
    await useEditorStore.getState().holdSaves();
    useEditorStore.getState().releaseSaves();
    useEditorStore.getState().setContent('# Idea\n\nx');
    await vi.advanceTimersByTimeAsync(2000);
    expect(calledCommands()).not.toContain('write_note');

    useEditorStore.getState().releaseSaves();
    await vi.advanceTimersByTimeAsync(1000);
    expect(calledCommands()).toContain('write_note');
  });

  it('never goes below zero on a stray release', async () => {
    routeInvoke({});
    useEditorStore.getState().releaseSaves();
    expect(useEditorStore.getState().saveHolds).toBe(0);
    await useEditorStore.getState().holdSaves();
    expect(useEditorStore.getState().saveHolds).toBe(1);
  });

  it('forces the hold off after 60 s so typing is never left unsaved', async () => {
    routeInvoke({});
    await useEditorStore.getState().holdSaves();
    useEditorStore.getState().setContent('# Idea\n\nperdido');
    await vi.advanceTimersByTimeAsync(59_000);
    expect(calledCommands()).not.toContain('write_note');

    await vi.advanceTimersByTimeAsync(1_000);
    expect(useEditorStore.getState().saveHolds).toBe(0);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(mockInvoke).toHaveBeenCalledWith('write_note', {
      path: NOTE,
      content: '# Idea\n\nperdido',
      vaultPath: '/vault',
    });
  });

  it('the safety timer does not fire after a normal release', async () => {
    routeInvoke({});
    await useEditorStore.getState().holdSaves();
    await vi.advanceTimersByTimeAsync(30_000);
    useEditorStore.getState().releaseSaves();
    await useEditorStore.getState().holdSaves();
    // 70 s after the first hold, 40 s into the second: the first timer must not end it.
    await vi.advanceTimersByTimeAsync(40_000);
    expect(useEditorStore.getState().saveHolds).toBe(1);
  });
});

describe('save block follows the note', () => {
  it('moves the block with a rename of the blocked note', async () => {
    useEditorStore.setState({ saveBlockedPath: NOTE });
    routeInvoke({ list_vault_tree: () => [] });
    await useEditorStore.getState().applyRelocation(NOTE, '/vault/proj/Nueva.md', []);
    expect(useEditorStore.getState().saveBlockedPath).toBe('/vault/proj/Nueva.md');
  });

  it('moves the block when the folder of the blocked note moves', async () => {
    useEditorStore.setState({ saveBlockedPath: NOTE });
    routeInvoke({ list_vault_tree: () => [] });
    await useEditorStore.getState().applyRelocation('/vault/proj', '/vault/arch/proj', []);
    expect(useEditorStore.getState().saveBlockedPath).toBe('/vault/arch/proj/Idea.md');
  });

  it('a switch to another vault clears the block', async () => {
    useEditorStore.setState({ saveBlockedPath: NOTE });
    routeInvoke({ get_active_vault: () => '/otra', list_vault_tree: () => [] });
    await useEditorStore.getState().initVault();
    expect(useEditorStore.getState().saveBlockedPath).toBeNull();
  });

  it('re-reading the same vault keeps the block', async () => {
    useEditorStore.setState({ saveBlockedPath: NOTE });
    routeInvoke({ get_active_vault: () => '/vault', list_vault_tree: () => [] });
    await useEditorStore.getState().initVault();
    expect(useEditorStore.getState().saveBlockedPath).toBe(NOTE);
  });
});

describe('note switching', () => {
  it('switching notes flushes the pending save of the previous note', async () => {
    routeInvoke({ read_note: () => '# Otra' });
    useEditorStore.getState().setContent('# Idea\n\núltimas teclas');

    await useEditorStore.getState().openNote('/vault/otra.md');

    expect(mockInvoke).toHaveBeenCalledWith('write_note', {
      path: NOTE,
      content: '# Idea\n\núltimas teclas',
      vaultPath: '/vault',
    });
    const cmds = calledCommands();
    expect(cmds.indexOf('write_note')).toBeLessThan(cmds.indexOf('read_note'));
    expect(useEditorStore.getState().activeNotePath).toBe('/vault/otra.md');
    // The debounced save must not fire later against the new note.
    await vi.advanceTimersByTimeAsync(2000);
    expect(calledCommands().filter((c) => c === 'write_note')).toHaveLength(1);
  });

  it('switch during sync hold defers the write until release', async () => {
    routeInvoke({ read_note: () => '# Otra' });
    await useEditorStore.getState().holdSaves();
    useEditorStore.getState().setContent('# Idea\n\ndurante el ciclo');

    await useEditorStore.getState().openNote('/vault/otra.md');

    // The switch is not blocked, and nothing is written while the cycle runs.
    expect(useEditorStore.getState().activeNotePath).toBe('/vault/otra.md');
    expect(calledCommands()).not.toContain('write_note');
    expect(useEditorStore.getState().deferredWrites[NOTE]?.content).toBe('# Idea\n\ndurante el ciclo');
    // The hold still defers normal autosaves.
    useEditorStore.getState().setContent('# Otra\n\nmás');
    await vi.advanceTimersByTimeAsync(5000);
    expect(calledCommands()).not.toContain('write_note');

    routeInvoke({ read_note: (a) => ((a as { path: string }).path === NOTE ? '# Idea' : '# Otra') });
    const result = await useEditorStore.getState().releaseSaves([]);

    expect(mockInvoke).toHaveBeenCalledWith('write_note', {
      path: NOTE,
      content: '# Idea\n\ndurante el ciclo',
      vaultPath: '/vault',
    });
    expect(result.written).toBe(1);
    expect(useEditorStore.getState().deferredWrites).toEqual({});
  });

  it('deferred note changed remotely gets conflict copy before write', async () => {
    routeInvoke({ read_note: () => '# Otra' });
    await useEditorStore.getState().holdSaves();
    useEditorStore.getState().setContent('# Idea\n\nlocal');
    await useEditorStore.getState().openNote('/vault/otra.md');

    routeInvoke({ read_note: () => '# Idea\n\nfusionada', write_conflict_copy: () => COPY });
    const result = await useEditorStore.getState().releaseSaves(['proj/Idea.md']);

    const cmds = calledCommands();
    expect(cmds).toContain('write_conflict_copy');
    expect(cmds.indexOf('write_conflict_copy')).toBeLessThan(cmds.lastIndexOf('write_note'));
    expect(mockInvoke).toHaveBeenCalledWith('write_conflict_copy', { path: NOTE, vaultPath: '/vault' });
    expect(mockInvoke).toHaveBeenCalledWith('write_note', {
      path: NOTE,
      content: '# Idea\n\nlocal',
      vaultPath: '/vault',
    });
    expect(result.copies).toEqual([COPY]);
    expect(result.failed).toBe(false);
  });

  it('deferred note unchanged remotely is written on release', async () => {
    routeInvoke({ read_note: () => '# Otra' });
    await useEditorStore.getState().holdSaves();
    useEditorStore.getState().setContent('# Idea\n\nlocal');
    await useEditorStore.getState().openNote('/vault/otra.md');

    routeInvoke({ read_note: () => '# Idea', write_conflict_copy: () => COPY });
    const result = await useEditorStore.getState().releaseSaves(['otra.md']);

    expect(calledCommands()).not.toContain('write_conflict_copy');
    expect(mockInvoke).toHaveBeenCalledWith('write_note', {
      path: NOTE,
      content: '# Idea\n\nlocal',
      vaultPath: '/vault',
    });
    expect(result.copies).toEqual([]);
  });

  it('keeps a deferred note pending when its conflict copy fails, and retries on the next release', async () => {
    routeInvoke({ read_note: () => '# Otra' });
    await useEditorStore.getState().holdSaves();
    useEditorStore.getState().setContent('# Idea\n\nlocal');
    await useEditorStore.getState().openNote('/vault/otra.md');

    routeInvoke({
      read_note: () => '# Idea\n\nfusionada',
      write_conflict_copy: () => {
        throw 'io_error: disk full';
      },
    });
    const failed = await useEditorStore.getState().releaseSaves(['proj/Idea.md']);
    expect(failed.failed).toBe(true);
    expect(calledCommands().filter((c) => c === 'write_conflict_copy')).toHaveLength(2);
    expect(calledCommands()).not.toContain('write_note');
    expect(useEditorStore.getState().deferredWrites[NOTE]?.blocked).toBe(true);

    // The next cycle changed nothing, but the remote version was never kept.
    await useEditorStore.getState().holdSaves();
    routeInvoke({ read_note: () => '# Idea\n\nfusionada', write_conflict_copy: () => COPY });
    const retried = await useEditorStore.getState().releaseSaves([]);
    expect(retried.copies).toEqual([COPY]);
    const cmds = calledCommands();
    expect(cmds.lastIndexOf('write_conflict_copy')).toBeLessThan(cmds.lastIndexOf('write_note'));
    expect(useEditorStore.getState().deferredWrites).toEqual({});
  });

  it('reopening a deferred note restores its buffer', async () => {
    routeInvoke({ read_note: () => '# Otra' });
    await useEditorStore.getState().holdSaves();
    useEditorStore.getState().setContent('# Idea\n\nlocal');
    await useEditorStore.getState().openNote('/vault/otra.md');

    await useEditorStore.getState().openNote(NOTE);

    const s = useEditorStore.getState();
    expect(s.activeNotePath).toBe(NOTE);
    expect(s.activeNoteContent).toBe('# Idea\n\nlocal');
    expect(s.isDirty).toBe(true);
    expect(s.deferredWrites).toEqual({});
    expect(calledCommands()).not.toContain('write_note');
  });

  it('hold-release without payload conflict-copies conservatively', async () => {
    // No record of what the editor last loaded: copy before writing.
    useEditorStore.setState({ diskContent: null });
    routeInvoke({ read_note: () => '# Otra' });
    await useEditorStore.getState().holdSaves();
    useEditorStore.getState().setContent('# Idea\n\nlocal');
    await useEditorStore.getState().openNote('/vault/otra.md');

    routeInvoke({ read_note: () => '# Idea', write_conflict_copy: () => COPY });
    const result = await useEditorStore.getState().releaseSaves('unknown');

    const cmds = calledCommands();
    expect(cmds.indexOf('write_conflict_copy')).toBeLessThan(cmds.lastIndexOf('write_note'));
    expect(result.copies).toEqual([COPY]);
  });

  it('hold-release without payload writes directly when disk still matches what was loaded', async () => {
    routeInvoke({ read_note: (a) => ((a as { path: string }).path === NOTE ? '# Idea' : '# Otra') });
    await useEditorStore.getState().openNote(NOTE);
    await useEditorStore.getState().holdSaves();
    useEditorStore.getState().setContent('# Idea\n\nlocal');
    await useEditorStore.getState().openNote('/vault/otra.md');

    const result = await useEditorStore.getState().releaseSaves('unknown');

    expect(calledCommands()).not.toContain('write_conflict_copy');
    expect(mockInvoke).toHaveBeenCalledWith('write_note', {
      path: NOTE,
      content: '# Idea\n\nlocal',
      vaultPath: '/vault',
    });
    expect(result.copies).toEqual([]);
  });

  it('hold-release without payload copies when disk differs from what was loaded', async () => {
    routeInvoke({ read_note: (a) => ((a as { path: string }).path === NOTE ? '# Idea' : '# Otra') });
    await useEditorStore.getState().openNote(NOTE);
    await useEditorStore.getState().holdSaves();
    useEditorStore.getState().setContent('# Idea\n\nlocal');
    await useEditorStore.getState().openNote('/vault/otra.md');

    routeInvoke({ read_note: () => '# Idea\n\nde otro equipo', write_conflict_copy: () => COPY });
    const result = await useEditorStore.getState().releaseSaves('unknown');

    expect(result.copies).toEqual([COPY]);
  });

  it('a new hold waits for the deferred writes before it is acknowledged', async () => {
    routeInvoke({ read_note: () => '# Otra' });
    await useEditorStore.getState().holdSaves();
    useEditorStore.getState().setContent('# Idea\n\nlocal');
    await useEditorStore.getState().openNote('/vault/otra.md');

    let finishWrite!: () => void;
    routeInvoke({
      read_note: () => '# Idea',
      write_note: () => new Promise<void>((r) => (finishWrite = r)),
    });
    const release = useEditorStore.getState().releaseSaves([]);
    let held = false;
    const hold = useEditorStore.getState().holdSaves().then(() => (held = true));
    await vi.advanceTimersByTimeAsync(0);
    expect(held).toBe(false);
    finishWrite();
    await release;
    await hold;
    expect(held).toBe(true);
  });

  it('switch during relocation flushes to the new path after it completes', async () => {
    const NEW = '/vault/proj/Nueva.md';
    routeInvoke({ read_note: () => '# Otra', list_vault_tree: () => [] });
    let finishRename!: () => void;
    const renamed = new Promise<void>((r) => (finishRename = r));
    const store = useEditorStore.getState();

    const relocation = store.runRelocation(
      () => renamed,
      () => useEditorStore.getState().applyRelocation(NOTE, NEW, []),
    );
    await vi.advanceTimersByTimeAsync(0);
    useEditorStore.getState().setContent('# Idea\n\nrenombrando');
    const switching = useEditorStore.getState().openNote('/vault/otra.md');
    await vi.advanceTimersByTimeAsync(0);
    expect(calledCommands()).not.toContain('write_note');

    finishRename();
    await relocation;
    await switching;

    const writes = mockInvoke.mock.calls.filter((c) => c[0] === 'write_note');
    expect(writes).toHaveLength(1);
    expect(writes[0][1]).toEqual({ path: NEW, content: '# Idea\n\nrenombrando', vaultPath: '/vault' });
    const cmds = calledCommands();
    expect(cmds.indexOf('write_note')).toBeLessThan(cmds.lastIndexOf('read_note'));
    expect(useEditorStore.getState().activeNotePath).toBe('/vault/otra.md');
    await vi.advanceTimersByTimeAsync(2000);
    expect(calledCommands().filter((c) => c === 'write_note')).toHaveLength(1);
  });

  it('a blocked note is never written on switch, even during a sync hold', async () => {
    routeInvoke({ read_note: () => '# Otra' });
    await useEditorStore.getState().holdSaves();
    useEditorStore.setState({ saveBlockedPath: NOTE });
    useEditorStore.getState().setContent('# Idea\n\nbloqueada');
    await useEditorStore.getState().openNote('/vault/otra.md');
    expect(calledCommands()).not.toContain('write_note');
    expect(useEditorStore.getState().deferredWrites[NOTE]?.blocked).toBe(true);

    // Release with no remote change: the block still forces the copy first.
    routeInvoke({ read_note: () => '# Idea remota', write_conflict_copy: () => COPY });
    await useEditorStore.getState().releaseSaves([]);
    const cmds = calledCommands();
    expect(cmds.indexOf('write_conflict_copy')).toBeLessThan(cmds.indexOf('write_note'));
  });

  it('does not flush a save-blocked note when switching', async () => {
    routeInvoke({ read_note: () => '# Otra' });
    useEditorStore.setState({ saveBlockedPath: NOTE });
    useEditorStore.getState().setContent('# Idea\n\nbloqueada');
    await useEditorStore.getState().openNote('/vault/otra.md');
    expect(calledCommands()).not.toContain('write_note');
  });
});

describe('deferred writes across relocations and reopening', () => {
  const OTHER = '/vault/otra.md';

  /** Hold for a sync cycle, type in NOTE, then switch away so its buffer is deferred. */
  async function deferNoteDuringHold(): Promise<void> {
    routeInvoke({ read_note: () => '# Otra' });
    await useEditorStore.getState().holdSaves();
    useEditorStore.getState().setContent('# Idea\n\nlocal');
    await useEditorStore.getState().openNote(OTHER);
    expect(useEditorStore.getState().deferredWrites[NOTE]).toBeDefined();
  }

  async function relocateDuringHold(newPath: string, relocate: () => Promise<void>): Promise<void> {
    let finishRelocation!: () => void;
    const relocated = new Promise<void>((r) => (finishRelocation = r));
    routeInvoke({
      read_note: (a) => {
        if ((a as { path: string }).path === NOTE) throw 'not_found: gone';
        return '# Idea';
      },
      rename_entry: () => relocated.then(() => ({ path: newPath, rewritten: [] })),
      move_entry: () => relocated.then(() => ({ path: '/vault/archivo/proj', rewritten: [] })),
      list_vault_tree: () => [],
    });
    const running = relocate();
    await vi.advanceTimersByTimeAsync(0);
    // The sync cycle ends first; the relocation still holds saves.
    await useEditorStore.getState().releaseSaves([]);
    expect(calledCommands()).not.toContain('write_note');
    finishRelocation();
    await running;
    await vi.advanceTimersByTimeAsync(2000);
  }

  function expectWrittenOnlyTo(newPath: string): void {
    const writes = mockInvoke.mock.calls.filter((c) => c[0] === 'write_note' || c[0] === 'chat_write_note');
    expect(writes).toEqual([['write_note', { path: newPath, content: '# Idea\n\nlocal', vaultPath: '/vault' }]]);
    expect(useEditorStore.getState().deferredWrites).toEqual({});
  }

  it('relocating a note with a deferred entry writes to the new path, never recreates the old one (rename)', async () => {
    useVaultStore.setState({ vaultPath: '/vault', tree: [], isLoading: false, error: null, selectedFolder: null });
    await deferNoteDuringHold();
    const NEW = '/vault/proj/Nueva.md';
    await relocateDuringHold(NEW, () => useVaultStore.getState().renameEntry(NOTE, 'Nueva.md'));
    expectWrittenOnlyTo(NEW);
  });

  it('relocating a note with a deferred entry writes to the new path, never recreates the old one (folder move)', async () => {
    useVaultStore.setState({ vaultPath: '/vault', tree: [], isLoading: false, error: null, selectedFolder: null });
    await deferNoteDuringHold();
    const NEW = '/vault/archivo/proj/Idea.md';
    await relocateDuringHold(NEW, () => useVaultStore.getState().moveEntry('/vault/proj', '/vault/archivo'));
    expectWrittenOnlyTo(NEW);
  });

  it('reopened deferred note during hold gets conflict copy on hold-release when disk changed', async () => {
    await deferNoteDuringHold();
    await useEditorStore.getState().openNote(NOTE);
    expect(useEditorStore.getState().isDirty).toBe(true);

    routeInvoke({ read_note: () => '# Idea\n\nde otro equipo', write_conflict_copy: () => COPY });
    const result = await useEditorStore.getState().releaseSaves('unknown');
    await vi.advanceTimersByTimeAsync(2000);

    const cmds = calledCommands();
    expect(cmds).toContain('write_conflict_copy');
    expect(cmds.indexOf('write_conflict_copy')).toBeLessThan(cmds.indexOf('write_note'));
    expect(mockInvoke).toHaveBeenCalledWith('write_note', {
      path: NOTE,
      content: '# Idea\n\nlocal',
      vaultPath: '/vault',
    });
    expect(result.copies).toEqual([COPY]);
    expect(useEditorStore.getState().isDirty).toBe(false);
  });

  it('reopened deferred note during hold is saved without a copy when disk is unchanged', async () => {
    await deferNoteDuringHold();
    await useEditorStore.getState().openNote(NOTE);

    routeInvoke({ read_note: () => '# Idea', write_conflict_copy: () => COPY });
    const result = await useEditorStore.getState().releaseSaves('unknown');
    await vi.advanceTimersByTimeAsync(2000);

    expect(calledCommands()).not.toContain('write_conflict_copy');
    expect(mockInvoke).toHaveBeenCalledWith('write_note', {
      path: NOTE,
      content: '# Idea\n\nlocal',
      vaultPath: '/vault',
    });
    expect(result.copies).toEqual([]);
  });

  it('reopened deferred note during sync-finished is evaluated against changedPaths', async () => {
    await deferNoteDuringHold();
    const changed = ['otra.md', 'proj/Idea.md'];
    routeInvoke({
      read_note: (a) => {
        if ((a as { path: string }).path === OTHER) {
          // The user goes back to the deferred note while the cycle is applied.
          void useEditorStore.getState().openNote(NOTE);
          return '# Otra remota';
        }
        return '# Idea\n\nfusionada';
      },
      write_conflict_copy: () => COPY,
    });

    await useEditorStore.getState().applyRemoteChanges(changed, '/vault');
    await useEditorStore.getState().releaseSaves(changed);
    await vi.advanceTimersByTimeAsync(2000);

    const cmds = calledCommands();
    expect(cmds.filter((c) => c === 'write_conflict_copy')).toHaveLength(1);
    expect(mockInvoke).toHaveBeenCalledWith('write_conflict_copy', { path: NOTE, vaultPath: '/vault' });
    expect(cmds.indexOf('write_conflict_copy')).toBeLessThan(cmds.indexOf('write_note'));
    expect(mockInvoke).toHaveBeenCalledWith('write_note', {
      path: NOTE,
      content: '# Idea\n\nlocal',
      vaultPath: '/vault',
    });
    expect(useEditorStore.getState().activeNotePath).toBe(NOTE);
  });

  it('keeps a deferred note pending and reports a write failure after its copy', async () => {
    await deferNoteDuringHold();
    routeInvoke({
      read_note: () => '# Idea\n\nfusionada',
      write_conflict_copy: () => COPY,
      write_note: () => {
        throw 'io_error: disk full';
      },
    });
    const result = await useEditorStore.getState().releaseSaves(['proj/Idea.md']);

    expect(result.copies).toEqual([COPY]);
    expect(result.writeFailed).toBe(true);
    expect(result.failed).toBe(false);
    expect(useEditorStore.getState().deferredWrites[NOTE]?.content).toBe('# Idea\n\nlocal');
  });

  it('reports a read failure of a deferred note as a write failure', async () => {
    await deferNoteDuringHold();
    routeInvoke({
      read_note: () => {
        throw 'io_error: permission denied';
      },
    });
    const result = await useEditorStore.getState().releaseSaves([]);

    expect(result.writeFailed).toBe(true);
    expect(result.failed).toBe(false);
    expect(useEditorStore.getState().deferredWrites[NOTE]).toBeDefined();
  });
});
