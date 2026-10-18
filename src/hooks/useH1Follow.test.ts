import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useEditorStore } from '../store/editorStore';

const followH1Title = vi.fn<[string], Promise<boolean>>();
const readH1 = vi.fn();
vi.mock('../lib/h1Follow', () => ({
  followH1Title: (t: string) => followH1Title(t),
  readH1: (e: unknown) => readH1(e),
}));

import { useH1Follow } from './useH1Follow';

type Handler = () => void;
function fakeEditor() {
  const handlers = new Map<string, Set<Handler>>();
  return {
    on: vi.fn((ev: string, h: Handler) => {
      if (!handlers.has(ev)) handlers.set(ev, new Set());
      handlers.get(ev)!.add(h);
    }),
    off: vi.fn((ev: string, h: Handler) => handlers.get(ev)?.delete(h)),
    emit: (ev: string) => handlers.get(ev)?.forEach((h) => h()),
    count: (ev: string) => handlers.get(ev)?.size ?? 0,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  followH1Title.mockResolvedValue(true);
  useEditorStore.setState({ activeNotePath: '/vault/Sin título.md', loadVersion: 1 });
});

afterEach(() => {
  vi.useRealTimers();
});

function setup() {
  const editor = fakeEditor();
  const hook = renderHook(() => useH1Follow(editor as never));
  return { editor, ...hook };
}

describe('useH1Follow', () => {
  it('renames after 1 s without typing in the H1', async () => {
    const { editor } = setup();
    readH1.mockReturnValue({ inH1: true, title: 'Mi idea' });
    act(() => editor.emit('update'));
    await act(() => vi.advanceTimersByTimeAsync(999));
    expect(followH1Title).not.toHaveBeenCalled();
    await act(() => vi.advanceTimersByTimeAsync(1));
    expect(followH1Title).toHaveBeenCalledTimes(1);
    expect(followH1Title).toHaveBeenCalledWith('Mi idea');
  });

  it('keeps waiting while the user keeps typing', async () => {
    const { editor } = setup();
    readH1.mockReturnValue({ inH1: true, title: 'M' });
    act(() => editor.emit('update'));
    await act(() => vi.advanceTimersByTimeAsync(800));
    readH1.mockReturnValue({ inH1: true, title: 'Mi' });
    act(() => editor.emit('update'));
    await act(() => vi.advanceTimersByTimeAsync(800));
    expect(followH1Title).not.toHaveBeenCalled();
    await act(() => vi.advanceTimersByTimeAsync(200));
    expect(followH1Title).toHaveBeenCalledTimes(1);
    expect(followH1Title).toHaveBeenCalledWith('Mi');
  });

  it('renames right away when the cursor leaves the H1', async () => {
    const { editor } = setup();
    readH1.mockReturnValue({ inH1: true, title: 'Idea' });
    act(() => editor.emit('update'));
    readH1.mockReturnValue({ inH1: false, title: 'Idea' });
    await act(async () => editor.emit('selectionUpdate'));
    expect(followH1Title).toHaveBeenCalledTimes(1);
    expect(followH1Title).toHaveBeenCalledWith('Idea');
    await act(() => vi.advanceTimersByTimeAsync(2000));
    expect(followH1Title).toHaveBeenCalledTimes(1);
  });

  it('renames right away when the editor loses focus while in the H1', async () => {
    const { editor } = setup();
    readH1.mockReturnValue({ inH1: true, title: 'Idea' });
    act(() => editor.emit('update'));
    await act(async () => editor.emit('blur'));
    expect(followH1Title).toHaveBeenCalledTimes(1);
    expect(followH1Title).toHaveBeenCalledWith('Idea');
  });

  it('ignores edits outside the H1', async () => {
    const { editor } = setup();
    readH1.mockReturnValue({ inH1: false, title: 'Idea' });
    act(() => editor.emit('update'));
    await act(() => vi.advanceTimersByTimeAsync(2000));
    await act(async () => editor.emit('blur'));
    expect(followH1Title).not.toHaveBeenCalled();
  });

  it('keeps the current name when the H1 is empty', async () => {
    const { editor } = setup();
    readH1.mockReturnValue({ inH1: true, title: '   ' });
    act(() => editor.emit('update'));
    await act(() => vi.advanceTimersByTimeAsync(1000));
    expect(followH1Title).not.toHaveBeenCalled();
  });

  it('does not repeat the same title', async () => {
    const { editor } = setup();
    readH1.mockReturnValue({ inH1: true, title: 'Idea' });
    act(() => editor.emit('update'));
    await act(() => vi.advanceTimersByTimeAsync(1000));
    act(() => editor.emit('update'));
    await act(() => vi.advanceTimersByTimeAsync(1000));
    expect(followH1Title).toHaveBeenCalledTimes(1);
  });

  it('stops asking once the note no longer follows its H1', async () => {
    followH1Title.mockResolvedValue(false);
    const { editor } = setup();
    readH1.mockReturnValue({ inH1: true, title: 'A' });
    act(() => editor.emit('update'));
    await act(() => vi.advanceTimersByTimeAsync(1000));
    readH1.mockReturnValue({ inH1: true, title: 'AB' });
    act(() => editor.emit('update'));
    await act(() => vi.advanceTimersByTimeAsync(1000));
    expect(followH1Title).toHaveBeenCalledTimes(1);
  });

  it('drops a pending rename when another note is loaded', async () => {
    const { editor } = setup();
    readH1.mockReturnValue({ inH1: true, title: 'Idea' });
    act(() => editor.emit('update'));
    act(() => useEditorStore.setState({ loadVersion: 2, activeNotePath: '/vault/otra.md' }));
    await act(() => vi.advanceTimersByTimeAsync(2000));
    expect(followH1Title).not.toHaveBeenCalled();
  });

  it('unsubscribes on unmount', () => {
    const { editor, unmount } = setup();
    expect(editor.count('update')).toBe(1);
    unmount();
    expect(editor.count('update')).toBe(0);
    expect(editor.count('selectionUpdate')).toBe(0);
    expect(editor.count('blur')).toBe(0);
  });
});
