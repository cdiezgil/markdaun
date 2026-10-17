import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import React from 'react';
import { listen } from '@tauri-apps/api/event';
import { StatusBar } from './StatusBar';
import { useEditorStore } from '../../store/editorStore';
import { useSyncStore } from '../../store/syncStore';
import { useLlmStore } from '../../store/llmStore';

const mockListen = vi.mocked(listen);

function renderBar() {
  return render(
    <MemoryRouter>
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
  });
  useSyncStore.setState({
    config: { repoUrl: null, isConnected: false },
    status: { hasChanges: false },
    isLoading: false,
    error: null,
  });
  useLlmStore.setState({ connections: [], active: null, loaded: true });
});
afterEach(() => { vi.useRealTimers(); });

describe('StatusBar', () => {
  it('hides note items when no note is open but keeps the AI selector', () => {
    renderBar();
    expect(screen.queryByTestId('note-stats')).not.toBeInTheDocument();
    expect(screen.getByTestId('model-switcher')).toBeInTheDocument();
  });

  it('renders inside a bar with the toolbar height', () => {
    renderBar();
    const bar = screen.getByTestId('status-bar');
    expect(bar.style.height).toBe('var(--toolbar-height)');
    expect(bar).toContainElement(screen.getByTestId('model-switcher'));
  });

  it('shows relative path, words, bytes, lines and reading time', () => {
    seedNote('# Hola mundo\n\ntres palabras más\n');
    renderBar();
    act(() => { vi.advanceTimersByTime(200); });
    expect(screen.getByTestId('note-path')).toHaveTextContent('Notes/idea.md');
    expect(screen.getByTestId('note-path')).toHaveAttribute('title', '/vault/Notes/idea.md');
    expect(screen.getByTestId('stat-words')).toHaveTextContent('5 words');
    expect(screen.getByTestId('stat-bytes')).toHaveTextContent('33 B');
    expect(screen.getByTestId('stat-lines')).toHaveTextContent('3 lines');
    expect(screen.getByTestId('stat-reading')).toHaveTextContent('<1 min');
  });

  it('shows selected / total words when there is a selection', () => {
    seedNote('uno dos tres cuatro', 'dos tres');
    renderBar();
    act(() => { vi.advanceTimersByTime(200); });
    expect(screen.getByTestId('stat-words')).toHaveTextContent('2 / 4 words');
  });

  it('debounces counter updates', () => {
    seedNote('uno');
    renderBar();
    act(() => { vi.advanceTimersByTime(200); });
    act(() => { useEditorStore.setState({ activeNoteContent: 'uno dos' }); });
    expect(screen.getByTestId('stat-words')).toHaveTextContent('1 word');
    act(() => { vi.advanceTimersByTime(200); });
    expect(screen.getByTestId('stat-words')).toHaveTextContent('2 words');
  });

  it('copies the relative path on click', () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    seedNote('x');
    renderBar();
    fireEvent.click(screen.getByTestId('note-path'));
    expect(writeText).toHaveBeenCalledWith('Notes/idea.md');
  });

  describe('app status', () => {
    it('hides sync when GitHub is not configured', () => {
      renderBar();
      expect(screen.queryByTestId('sync-status')).not.toBeInTheDocument();
    });

    it('shows up to date / pending / syncing', () => {
      useSyncStore.setState({ config: { repoUrl: 'u', isConnected: true } });
      renderBar();
      expect(screen.getByTestId('sync-status')).toHaveTextContent('Up to date');
      act(() => { useSyncStore.setState({ status: { hasChanges: true } }); });
      expect(screen.getByTestId('sync-status')).toHaveTextContent('Changes pending');
      act(() => { useSyncStore.setState({ isLoading: true }); });
      expect(screen.getByTestId('sync-status')).toHaveTextContent('Syncing');
    });

    it('styles sync errors with danger and exposes detail in tooltip', () => {
      useSyncStore.setState({ config: { repoUrl: 'u', isConnected: true }, error: 'auth failed' });
      renderBar();
      const el = screen.getByTestId('sync-status');
      expect(el).toHaveTextContent('Sync error');
      expect(el).toHaveAttribute('title', 'auth failed');
      expect(el.style.color).toBe('var(--danger)');
    });

    it('shows save state only with a note', () => {
      renderBar();
      expect(screen.queryByTestId('save-state')).not.toBeInTheDocument();
    });

    it('shows Unsaved while saving and Saved otherwise', () => {
      seedNote('x');
      renderBar();
      expect(screen.getByTestId('save-state')).toHaveTextContent('Saved');
      act(() => { useEditorStore.setState({ saveStatus: 'saving' }); });
      expect(screen.getByTestId('save-state')).toHaveTextContent('Unsaved');
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
      expect(screen.getByTestId('index-status')).toHaveTextContent('Indexing 3/12');
      act(() => cb({ payload: { done: 12, total: 12 } }));
      expect(screen.queryByTestId('index-status')).not.toBeInTheDocument();
    });
  });
});
