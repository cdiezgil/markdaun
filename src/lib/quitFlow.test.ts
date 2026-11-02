import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('./tauri', async (orig) => ({
  ...(await orig<typeof import('./tauri')>()),
  writeNote: vi.fn().mockResolvedValue(undefined),
  syncBeforeQuit: vi.fn(),
  syncCancelQuit: vi.fn(),
  quitApp: vi.fn(),
}));

import { writeNote, syncBeforeQuit, syncCancelQuit, quitApp } from './tauri';
import { useEditorStore } from '../store/editorStore';
import { finishQuit, flushEditsForQuit, QUIT_FLUSH_TIMEOUT_MS } from './quitFlow';

const base = {
  saveHolds: 0,
  isDirty: false,
  saveBlockedPath: null,
  deferredWrites: {},
  activeNotePath: null,
  activeNoteContent: null,
  vaultPath: '/v',
};

// Tests replace actions (e.g. a hung `saveNow`); every test starts from the real ones.
const initial = useEditorStore.getState();

beforeEach(() => {
  vi.clearAllMocks();
  useEditorStore.setState({ ...initial, ...base });
});
afterEach(() => {
  vi.useRealTimers();
});

describe('flushEditsForQuit', () => {
  it('resolves true when nothing is pending', async () => {
    expect(await flushEditsForQuit()).toBe(true);
  });

  it('never writes a save-blocked note and reports it as not written', async () => {
    useEditorStore.setState({
      activeNotePath: '/v/a.md',
      activeNoteContent: 'mine',
      isDirty: true,
      saveBlockedPath: '/v/a.md',
    });
    expect(await flushEditsForQuit()).toBe(false);
    expect(writeNote).not.toHaveBeenCalled();
  });

  it('gives up after the time bound when saveNow never resolves', async () => {
    vi.useFakeTimers();
    useEditorStore.setState({ saveNow: () => new Promise<void>(() => {}) });
    const p = flushEditsForQuit();
    await vi.advanceTimersByTimeAsync(QUIT_FLUSH_TIMEOUT_MS + 1);
    expect(await p).toBe(false);
  });

  it('never ends a sync hold early: waits for it, then writes', async () => {
    vi.useFakeTimers();
    useEditorStore.setState({ activeNotePath: '/v/a.md', activeNoteContent: 'old', diskContent: 'old' });
    await useEditorStore.getState().holdSaves();
    useEditorStore.getState().setContent('mine');
    const p = flushEditsForQuit();
    await vi.advanceTimersByTimeAsync(5_000);
    expect(useEditorStore.getState().saveHolds).toBe(1);
    expect(writeNote).not.toHaveBeenCalled();
    // The cycle ends (Rust waits for it before quitting).
    await useEditorStore.getState().releaseSaves([]);
    await vi.advanceTimersByTimeAsync(2_000);
    expect(await p).toBe(true);
    expect(writeNote).toHaveBeenCalledWith('/v/a.md', 'mine', '/v');
  });

  it('gives up after the time bound when a hold never ends, without releasing it', async () => {
    vi.useFakeTimers();
    useEditorStore.setState({ saveHolds: 1, isDirty: true, activeNotePath: '/v/a.md', activeNoteContent: 'x' });
    const release = vi.spyOn(useEditorStore.getState(), 'releaseSaves');
    const p = flushEditsForQuit();
    await vi.advanceTimersByTimeAsync(QUIT_FLUSH_TIMEOUT_MS + 1);
    expect(await p).toBe(false);
    expect(release).not.toHaveBeenCalled();
    expect(useEditorStore.getState().saveHolds).toBe(1);
  });
});

describe('finishQuit', () => {
  it('a failed quit_app after the final sync resumes automatic sync', async () => {
    vi.mocked(syncBeforeQuit).mockResolvedValue(undefined);
    vi.mocked(syncCancelQuit).mockResolvedValue(undefined);
    vi.mocked(quitApp).mockRejectedValue(new Error('nope'));
    await expect(finishQuit(true)).rejects.toThrow('nope');
    expect(syncCancelQuit).toHaveBeenCalledTimes(1);
  });

  it('a successful quit never cancels', async () => {
    vi.mocked(syncBeforeQuit).mockResolvedValue(undefined);
    vi.mocked(quitApp).mockResolvedValue(undefined);
    await finishQuit(true);
    expect(syncCancelQuit).not.toHaveBeenCalled();
  });
});
