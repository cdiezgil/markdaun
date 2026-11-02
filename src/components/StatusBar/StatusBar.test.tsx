import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act, fireEvent } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import React from 'react';
import { listen } from '@tauri-apps/api/event';
import { StatusBar } from './StatusBar';
import { useEditorStore } from '../../store/editorStore';
import { useSyncStore } from '../../store/syncStore';
import type { SyncState } from '../../lib/tauri';
import { useLlmStore } from '../../store/llmStore';
import { useGraphStore } from '../../store/graphStore';

const mockListen = vi.mocked(listen);

function renderBar(path = '/') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <StatusBar />
    </MemoryRouter>,
  );
}

function seedNote(content: string, selectionText = '') {
  useEditorStore.setState({
    vaultPath: '/vault',
    activeNotePath: '/vault/Notes/idea.md',
    activeNoteContent: content,
    selectionText,
    saveStatus: 'saved',
    isDirty: false,
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  useEditorStore.setState({
    vaultPath: '/vault',
    activeNotePath: null,
    activeNoteContent: null,
    selectionText: '',
    saveStatus: 'idle',
    isDirty: false,
  });
  useSyncStore.setState({
    config: { repoUrl: null, isConnected: false },
    status: { hasChanges: false },
    state: null,
    connecting: false,
    error: null,
    running: false,
    localPending: false,
  });
  useLlmStore.setState({ connections: [], active: null, loaded: true });
});
afterEach(() => { vi.useRealTimers(); });

function syncState(
  over: Partial<SyncState> = {},
  view: Partial<SyncState['view']> = {},
): SyncState {
  return {
    report: null,
    error: null,
    view: { running: false, pendingDebounce: false, consecutiveFailures: 0, offline: false, halted: false, needsReview: false, ...view },
    status: { uncommitted: false, ahead: 0 },
    pausedReason: null,
    pendingConflicts: [],
    lastSuccess: null,
    ...over,
  };
}

describe('StatusBar', () => {
  it('hides note items when no note is open but keeps the AI selector', () => {
    renderBar();
    expect(screen.queryByTestId('note-stats')).not.toBeInTheDocument();
    expect(screen.getByTestId('model-switcher')).toBeInTheDocument();
  });

  it('renders inside a 30px bar on the sunken surface', () => {
    renderBar();
    const bar = screen.getByTestId('status-bar');
    expect(bar.style.height).toBe('30px');
    expect(bar.style.background).toBe('var(--surface-sunken)');
    expect(bar).toContainElement(screen.getByTestId('model-switcher'));
  });

  it('shows relative path, words, bytes, lines and reading time', () => {
    seedNote('# Hola mundo\n\ntres palabras más\n');
    renderBar();
    act(() => { vi.advanceTimersByTime(200); });
    expect(screen.getByTestId('note-path')).toHaveTextContent('Notes/idea.md');
    expect(screen.getByTestId('note-path')).toHaveAttribute('title', '/vault/Notes/idea.md');
    expect(screen.getByTestId('stat-words')).toHaveTextContent('5 palabras');
    expect(screen.getByTestId('stat-bytes')).toHaveTextContent('33 B');
    expect(screen.getByTestId('stat-lines')).toHaveTextContent('3 líneas');
    expect(screen.getByTestId('stat-reading')).toHaveTextContent('<1 min');
  });

  it('shows selected / total words when there is a selection', () => {
    seedNote('uno dos tres cuatro', 'dos tres');
    renderBar();
    act(() => { vi.advanceTimersByTime(200); });
    expect(screen.getByTestId('stat-words')).toHaveTextContent('2 / 4 palabras');
  });

  it('debounces counter updates', () => {
    seedNote('uno');
    renderBar();
    act(() => { vi.advanceTimersByTime(200); });
    act(() => { useEditorStore.setState({ activeNoteContent: 'uno dos' }); });
    expect(screen.getByTestId('stat-words')).toHaveTextContent('1 palabra');
    act(() => { vi.advanceTimersByTime(200); });
    expect(screen.getByTestId('stat-words')).toHaveTextContent('2 palabras');
  });

  it('copies the relative path on click', () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    seedNote('x');
    renderBar();
    fireEvent.click(screen.getByTestId('note-path'));
    expect(writeText).toHaveBeenCalledWith('Notes/idea.md');
  });

  describe('contextual by view', () => {
    const graphNodes = [
      { id: 'a', position: { x: 0, y: 0 }, data: { kind: 'md', isOrphan: false } },
      { id: 'b', position: { x: 0, y: 0 }, data: { kind: 'md', isOrphan: true } },
    ];

    it('editor: shows a status dot with the save state', () => {
      seedNote('x');
      renderBar('/editor/abc');
      expect(screen.getByTestId('save-state')).toHaveTextContent('Guardado');
      expect(screen.getByTestId('save-dot').style.width).toBe('6px');
      expect(screen.getByTestId('save-dot').style.background).toBe('var(--daun)');
      act(() => { useEditorStore.setState({ isDirty: true }); });
      expect(screen.getByTestId('save-dot').style.background).toBe('var(--amber)');
    });

    it('graph: shows graph counts and the AI selector, no note data', () => {
      seedNote('x');
      useGraphStore.setState({
        nodes: graphNodes as never,
        edges: [{ id: 'e', source: 'a', target: 'b' }],
      });
      renderBar('/graph');
      expect(screen.getByTestId('graph-stats')).toHaveTextContent('2 notas · 1 enlace · 1 huérfana');
      expect(screen.getByTestId('model-switcher')).toBeInTheDocument();
      expect(screen.queryByTestId('note-stats')).not.toBeInTheDocument();
      expect(screen.queryByTestId('save-state')).not.toBeInTheDocument();
    });

    it('graph: counts only the notes inside the selected folder', () => {
      seedNote('x');
      useGraphStore.setState({
        nodes: graphNodes as never,
        edges: [{ id: 'e', source: 'a', target: 'b' }],
        model: { nodes: [], edges: [], tagNodes: [], tagEdges: [], outside: new Set(['b']) },
      });
      renderBar('/graph');
      expect(screen.getByTestId('graph-stats')).toHaveTextContent('1 nota · 0 enlaces · 0 huérfanas');
      useGraphStore.setState({ model: null });
    });

    it('brain: shows sync state and the AI selector, no note data', () => {
      seedNote('x');
      useSyncStore.setState({ config: { repoUrl: 'u', isConnected: true } });
      renderBar('/brain');
      expect(screen.getByTestId('sync-status')).toHaveTextContent('Al día');
      expect(screen.getByTestId('model-switcher')).toBeInTheDocument();
      expect(screen.queryByTestId('note-stats')).not.toBeInTheDocument();
      expect(screen.queryByTestId('save-state')).not.toBeInTheDocument();
      expect(screen.queryByTestId('graph-stats')).not.toBeInTheDocument();
    });

    it('editor: does not show graph counts', () => {
      renderBar('/');
      expect(screen.queryByTestId('graph-stats')).not.toBeInTheDocument();
    });
  });

  describe('app status', () => {
    it('hides sync when GitHub is not configured', () => {
      renderBar();
      expect(screen.queryByTestId('sync-status')).not.toBeInTheDocument();
    });

    it('shows up to date / pending / syncing', () => {
      useSyncStore.setState({ config: { repoUrl: 'u', isConnected: true } });
      renderBar();
      expect(screen.getByTestId('sync-status')).toHaveTextContent('Al día');
      act(() => { useSyncStore.setState({ state: syncState({ status: { uncommitted: true, ahead: 0 } }) }); });
      expect(screen.getByTestId('sync-status')).toHaveTextContent('Pendiente');
      act(() => { useSyncStore.setState({ state: syncState(), running: true }); });
      expect(screen.getByTestId('sync-status')).toHaveTextContent('Sincronizando');
      act(() => { useSyncStore.setState({ state: syncState({}, { offline: true }), running: false }); });
      expect(screen.getByTestId('sync-status')).toHaveTextContent('Sin conexión');
      act(() => { useSyncStore.setState({ state: syncState({ pausedReason: 'deletion' }) }); });
      expect(screen.getByTestId('sync-status')).toHaveTextContent('Requiere revisión');
    });

    it('renders each indicator label', () => {
      useSyncStore.setState({ config: { repoUrl: 'u', isConnected: true } });
      renderBar();
      const cases: [Partial<SyncState>, Partial<SyncState['view']>, boolean, string][] = [
        [{}, {}, false, 'Al día'],
        [{ status: { uncommitted: true, ahead: 0 } }, {}, false, 'Pendiente'],
        [{}, {}, true, 'Sincronizando'],
        [{}, { offline: true }, false, 'Sin conexión'],
        [{ pendingConflicts: ['a.md'] }, {}, false, 'Requiere revisión'],
        [{}, { needsReview: true }, false, 'Requiere revisión'],
      ];
      for (const [over, view, running, label] of cases) {
        act(() => { useSyncStore.setState({ state: syncState(over, view), running }); });
        expect(screen.getByTestId('sync-status')).toHaveTextContent(label);
      }
    });

    it('a save shows "Pendiente" before the backend reports it', () => {
      useSyncStore.setState({ config: { repoUrl: 'u', isConnected: true }, state: syncState(), running: false });
      renderBar();
      expect(screen.getByTestId('sync-status')).toHaveTextContent('Al día');
      act(() => { useSyncStore.getState().markPending(); });
      expect(screen.getByTestId('sync-status')).toHaveTextContent('Pendiente');
    });

    it('frontend-only conflict copies need review too', () => {
      useSyncStore.setState({
        config: { repoUrl: 'u', isConnected: true },
        state: syncState(),
        localConflicts: ['a (conflicto x).md'],
      });
      renderBar();
      expect(screen.getByTestId('sync-status')).toHaveTextContent('Requiere revisión');
      useSyncStore.setState({ localConflicts: [] });
    });

    it('tooltip shows the Spanish error text when review is needed', () => {
      useSyncStore.setState({
        config: { repoUrl: 'u', isConnected: true },
        state: syncState({ error: { kind: 'unauthorized', detail: 'x' } }, { halted: true }),
      });
      renderBar();
      expect(screen.getByTestId('sync-status')).toHaveAttribute('title', 'Token de GitHub no válido o caducado');
    });

    it('click triggers manual sync', () => {
      const syncNow = vi.fn().mockResolvedValue(undefined);
      useSyncStore.setState({ config: { repoUrl: 'u', isConnected: true }, state: syncState(), syncNow });
      renderBar();
      fireEvent.click(screen.getByTestId('sync-status'));
      expect(syncNow).toHaveBeenCalledTimes(1);
    });

    it('click opens the GitHub settings when the token was rejected', () => {
      const syncNow = vi.fn().mockResolvedValue(undefined);
      useSyncStore.setState({
        config: { repoUrl: 'u', isConnected: true },
        state: syncState({ error: { kind: 'unauthorized', detail: 'x' } }, { halted: true }),
        syncNow,
      });
      let path = '';
      function Probe(): null {
        path = useLocation().pathname + useLocation().hash;
        return null;
      }
      render(
        <MemoryRouter initialEntries={['/']}>
          <StatusBar />
          <Probe />
        </MemoryRouter>,
      );
      fireEvent.click(screen.getByTestId('sync-status'));
      expect(path).toBe('/settings#github');
      expect(syncNow).not.toHaveBeenCalled();
    });

    it('click opens deletion dialog when paused', () => {
      const syncNow = vi.fn().mockResolvedValue(undefined);
      const openDeletionPrompt = vi.fn();
      useSyncStore.setState({
        config: { repoUrl: 'u', isConnected: true },
        state: syncState({ pausedReason: 'deletion' }),
        syncNow,
        openDeletionPrompt,
      });
      renderBar();
      fireEvent.click(screen.getByTestId('sync-status'));
      expect(openDeletionPrompt).toHaveBeenCalledTimes(1);
      expect(syncNow).not.toHaveBeenCalled();
    });

    it('never says Guardado while a write is deferred or blocked', () => {
      seedNote('x');
      renderBar();
      act(() => {
        useEditorStore.setState({
          deferredWrites: { '/vault/y.md': { content: 'c', vault: '/vault', base: null, blocked: false } },
        });
      });
      expect(screen.getByTestId('save-state')).toHaveTextContent('Sin guardar');
      act(() => { useEditorStore.setState({ deferredWrites: {}, saveBlockedPath: '/vault/x.md' }); });
      expect(screen.getByTestId('save-state')).toHaveTextContent('Sin guardar');
      act(() => { useEditorStore.setState({ saveBlockedPath: null }); });
      expect(screen.getByTestId('save-state')).toHaveTextContent('Guardado');
    });

    it('styles sync errors with danger and exposes detail in tooltip', () => {
      useSyncStore.setState({ config: { repoUrl: 'u', isConnected: true }, error: 'auth failed' });
      renderBar();
      const el = screen.getByTestId('sync-status');
      expect(el).toHaveTextContent('Error de sincronización');
      expect(el).toHaveAttribute('title', 'auth failed');
      expect(el.style.color).toBe('var(--danger)');
    });

    it('shows save state only with a note', () => {
      renderBar();
      expect(screen.queryByTestId('save-state')).not.toBeInTheDocument();
    });

    it('shows Sin guardar while dirty and Guardado otherwise', () => {
      seedNote('x');
      renderBar();
      expect(screen.getByTestId('save-state')).toHaveTextContent('Guardado');
      act(() => { useEditorStore.setState({ isDirty: true }); });
      expect(screen.getByTestId('save-state')).toHaveTextContent('Sin guardar');
    });

    it('shows indexing only while progress is active', async () => {
      let cb: (e: { payload: { done: number; total: number } }) => void = () => {};
      mockListen.mockImplementation((async (_n: string, handler: typeof cb) => {
        cb = handler;
        return () => {};
      }) as never);
      renderBar();
      await act(async () => { await Promise.resolve(); });
      expect(screen.queryByTestId('index-status')).not.toBeInTheDocument();
      act(() => cb({ payload: { done: 3, total: 12 } }));
      expect(screen.getByTestId('index-status')).toHaveTextContent('Indexando 3/12');
      act(() => cb({ payload: { done: 12, total: 12 } }));
      expect(screen.queryByTestId('index-status')).not.toBeInTheDocument();
    });

    it('TC-62f: muestra «N notas indexadas» al terminar y desaparece tras 3 s', async () => {
      let cb: (e: { payload: { done: number; total: number } }) => void = () => {};
      mockListen.mockImplementation((async (_n: string, handler: typeof cb) => {
        cb = handler;
        return () => {};
      }) as never);
      renderBar();
      await act(async () => { await Promise.resolve(); });

      // Simulate completion: done === total === 5
      act(() => cb({ payload: { done: 5, total: 5 } }));
      expect(screen.getByTestId('index-completed')).toHaveTextContent('5 notas indexadas');
      expect(screen.queryByTestId('index-status')).not.toBeInTheDocument();

      // After 3 000 ms the completed message disappears
      act(() => { vi.advanceTimersByTime(3000); });
      expect(screen.queryByTestId('index-completed')).not.toBeInTheDocument();
    });
  });
});
