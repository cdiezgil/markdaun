import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import type { SyncState } from '../lib/tauri';
import { useEditorStore } from '../store/editorStore';
import { useSyncStore } from '../store/syncStore';
import { useAutoSync } from './useAutoSync';

const mockInvoke = vi.mocked(invoke);
const mockListen = vi.mocked(listen);
const NOTE = '/vault/proj/Idea.md';
const COPY = 'proj/Idea (conflicto 2026-11-02 10-30).md';

type Handler = (event: { payload: unknown }) => void;
let handlers: Record<string, Handler>;

function makeState(over: Partial<SyncState> = {}): SyncState {
  return {
    report: null,
    error: null,
    view: { running: false, pendingDebounce: false, consecutiveFailures: 0, offline: false, halted: false },
    status: { uncommitted: false, ahead: 0 },
    pausedReason: null,
    pendingConflicts: [],
    lastSuccess: null,
    ...over,
  };
}

function finished(changedPaths: string[]): SyncState {
  return makeState({
    report: { changedPaths, conflicts: [], needsConfirmation: null, pushed: true },
  });
}

function routeInvoke(handlersByCmd: Record<string, (args: unknown) => unknown>) {
  mockInvoke.mockImplementation(async (cmd: string, args?: unknown) => {
    const h = handlersByCmd[cmd];
    return h ? h(args) : undefined;
  });
}

function commands(): string[] {
  return mockInvoke.mock.calls.map((c) => c[0] as string);
}

async function emit(name: string, payload?: unknown) {
  await act(async () => {
    handlers[name]({ payload });
    await vi.advanceTimersByTimeAsync(0);
  });
}

async function mount(showToast = vi.fn()) {
  const view = renderHook(() => useAutoSync(showToast));
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0);
  });
  return { ...view, showToast };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  handlers = {};
  mockListen.mockImplementation(async (name: string, handler: unknown) => {
    handlers[name] = handler as Handler;
    return () => {};
  });
  routeInvoke({ sync_get_state: () => makeState() });
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
  useSyncStore.setState({ state: null, conflicts: [], vaultChangeCount: 0 });
});

afterEach(() => {
  vi.useRealTimers();
});

describe('useAutoSync', () => {
  it('loads the sync state on mount', async () => {
    routeInvoke({ sync_get_state: () => makeState({ lastSuccess: '2026-11-02T10:00:00Z' }) });
    await mount();
    expect(commands()).toContain('sync_get_state');
    expect(useSyncStore.getState().state?.lastSuccess).toBe('2026-11-02T10:00:00Z');
  });

  it('acks hold after flush', async () => {
    routeInvoke({ sync_get_state: () => makeState() });
    await mount();
    useEditorStore.getState().setContent('# Idea\n\npendiente');

    await emit('sync-will-start');

    const cmds = commands();
    expect(cmds).toContain('write_note');
    expect(cmds).toContain('sync_hold_ack');
    expect(cmds.indexOf('write_note')).toBeLessThan(cmds.indexOf('sync_hold_ack'));
    expect(useEditorStore.getState().saveHolds).toBe(1);
  });

  it('releases the hold on sync-hold-release', async () => {
    await mount();
    await emit('sync-will-start');
    await emit('sync-hold-release');
    expect(useEditorStore.getState().saveHolds).toBe(0);
  });

  it('shows "Nota actualizada desde GitHub" toast on reload', async () => {
    routeInvoke({ sync_get_state: () => makeState(), read_note: () => '# Remota' });
    const { showToast } = await mount();
    await emit('sync-will-start');

    await emit('sync-finished', finished(['proj/Idea.md']));

    expect(showToast).toHaveBeenCalledWith('Nota actualizada desde GitHub');
    expect(useEditorStore.getState().activeNoteContent).toBe('# Remota');
    expect(useEditorStore.getState().saveHolds).toBe(0);
    expect(useSyncStore.getState().vaultChangeCount).toBe(1);
    expect(commands()).toContain('list_vault_tree');
  });

  it('shows "La nota se borró en GitHub" toast when the clean note was deleted', async () => {
    routeInvoke({
      sync_get_state: () => makeState(),
      read_note: () => {
        throw 'path_not_found';
      },
    });
    const { showToast } = await mount();
    await emit('sync-finished', finished(['proj/Idea.md']));
    expect(showToast).toHaveBeenCalledWith('La nota se borró en GitHub');
    expect(useEditorStore.getState().activeNotePath).toBeNull();
  });

  it('adds the conflict copy to the conflicts notice', async () => {
    routeInvoke({
      sync_get_state: () => makeState(),
      read_note: () => '# Remota',
      write_conflict_copy: () => COPY,
    });
    const { showToast } = await mount();
    await emit('sync-will-start');
    useEditorStore.getState().setContent('# Idea\n\ntecleado');

    await emit('sync-finished', finished(['proj/Idea.md']));

    expect(useSyncStore.getState().conflicts).toEqual([COPY]);
    expect(showToast).not.toHaveBeenCalled();
  });

  it('keeps the frontend conflict copy when a later cycle reports backend conflicts', async () => {
    routeInvoke({
      sync_get_state: () => makeState(),
      read_note: () => '# Remota',
      write_conflict_copy: () => COPY,
    });
    await mount();
    useEditorStore.setState({ activeNoteContent: '# Idea\n\ntecleado', isDirty: true });
    await emit('sync-finished', finished(['proj/Idea.md']));
    await emit('sync-finished', makeState({ pendingConflicts: ['b (conflicto x).md'] }));
    expect(useSyncStore.getState().conflicts).toEqual(['b (conflicto x).md', COPY]);
  });

  it('does nothing to the note when the cycle did not touch it', async () => {
    const { showToast } = await mount();
    await emit('sync-will-start');
    await emit('sync-finished', finished(['otra.md']));
    expect(showToast).not.toHaveBeenCalled();
    expect(commands()).not.toContain('read_note');
    expect(useEditorStore.getState().saveHolds).toBe(0);
  });

  it('triggers a sync after each successful save', async () => {
    await mount();
    useEditorStore.getState().setContent('# Idea\n\nnuevo');
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(mockInvoke).toHaveBeenCalledWith('sync_trigger', { reason: 'changed' });
  });
});
