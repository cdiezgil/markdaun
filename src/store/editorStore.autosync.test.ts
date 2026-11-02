import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import { useEditorStore } from './editorStore';

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
