import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('./tauri', async (orig) => ({
  ...(await orig<typeof import('./tauri')>()),
  writeNote: vi.fn().mockResolvedValue(undefined),
  syncBeforeQuit: vi.fn(),
  quitApp: vi.fn(),
}));

import { writeNote } from './tauri';
import { useEditorStore } from '../store/editorStore';
import { flushEditsForQuit, QUIT_FLUSH_TIMEOUT_MS, MAX_QUIT_RELEASES } from './quitFlow';

const base = {
  saveHolds: 0,
  isDirty: false,
  saveBlockedPath: null,
  deferredWrites: {},
  activeNotePath: null,
  activeNoteContent: null,
  vaultPath: '/v',
};

beforeEach(() => {
  vi.clearAllMocks();
  useEditorStore.setState(base);
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

  it('gives up after the time bound when releaseSaves never resolves', async () => {
    vi.useFakeTimers();
    useEditorStore.setState({
      saveHolds: 1,
      releaseSaves: () => new Promise(() => {}),
    });
    const p = flushEditsForQuit();
    await vi.advanceTimersByTimeAsync(QUIT_FLUSH_TIMEOUT_MS + 1);
    expect(await p).toBe(false);
  });

  it('caps the release loop when holds never go away', async () => {
    const release = vi.fn().mockResolvedValue({});
    useEditorStore.setState({ saveHolds: 1, releaseSaves: release });
    expect(await flushEditsForQuit()).toBe(false);
    expect(release).toHaveBeenCalledTimes(MAX_QUIT_RELEASES);
  });
});
