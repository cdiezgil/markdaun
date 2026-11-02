import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the tauri lib so no real Tauri invoke is needed
vi.mock('../lib/tauri', () => ({
  githubConnectPreview: vi.fn(),
  githubConnectApply: vi.fn(),
  githubGetConfig: vi.fn(),
  githubDisconnect: vi.fn(),
  githubStatus: vi.fn(),
  syncTrigger: vi.fn(),
  syncConfirmDeletions: vi.fn(),
  syncDismissConflicts: vi.fn(),
  syncGetState: vi.fn(),
}));

import {
  githubConnectPreview,
  githubConnectApply,
  githubGetConfig,
  githubDisconnect,
  syncTrigger,
  syncConfirmDeletions,
  syncDismissConflicts,
  syncGetState,
} from '../lib/tauri';
import type { SyncState } from '../lib/tauri';
import { useSyncStore, indicatorFor, syncErrorText } from './syncStore';

const mockPreview = vi.mocked(githubConnectPreview);
const mockApply = vi.mocked(githubConnectApply);
const mockGetConfig = vi.mocked(githubGetConfig);
const mockDisconnect = vi.mocked(githubDisconnect);
const mockTrigger = vi.mocked(syncTrigger);
const mockConfirm = vi.mocked(syncConfirmDeletions);
const mockDismiss = vi.mocked(syncDismissConflicts);
const mockGetState = vi.mocked(syncGetState);

function makeState(over: Partial<SyncState> = {}, view: Partial<SyncState['view']> = {}): SyncState {
  return {
    report: null,
    error: null,
    view: {
      running: false,
      pendingDebounce: false,
      consecutiveFailures: 0,
      offline: false,
      halted: false,
      needsReview: false,
      ...view,
    },
    status: { uncommitted: false, ahead: 0 },
    pausedReason: null,
    pendingConflicts: [],
    lastSuccess: null,
    ...over,
  };
}

describe('useSyncStore', () => {
  beforeEach(() => {
    // Reset store to initial state
    useSyncStore.setState({
      config: { repoUrl: null, isConnected: false },
      status: { hasChanges: false },
      state: null,
      connecting: false,
      error: null,
      connectAction: null,
      pendingConnect: null,
      pendingDeletion: null,
      deletionPromptOpen: false,
      deletionPromptShown: false,
      conflicts: [],
      localConflicts: [],
      vaultChangeCount: 0,
    });
    vi.clearAllMocks();
    mockGetState.mockResolvedValue(makeState());
  });

  // ─── connect = preview first, apply only after the user's choice ─────────

  const URL = 'https://github.com/u/r';

  it('TC-15: connect on an empty remote previews then applies directly (no dialog)', async () => {
    mockPreview.mockResolvedValue({ case: 'remote_empty', remoteCount: 0, localCount: 3 });
    mockApply.mockResolvedValue({ action: 'pushed', conflicts: [] });

    await useSyncStore.getState().connect(URL, 'token', '/vault');

    expect(mockPreview).toHaveBeenCalledWith(URL, 'token', '/vault');
    expect(mockApply).toHaveBeenCalledWith(URL, 'token', '/vault', 'sync');
    const s = useSyncStore.getState();
    expect(s.config.isConnected).toBe(true);
    expect(s.connectAction).toBe('pushed');
    expect(s.pendingConnect).toBeNull();
    expect(mockGetState).toHaveBeenCalled();
  });

  it('TC-15b: remote with notes + empty vault asks first and applies NOTHING yet', async () => {
    mockPreview.mockResolvedValue({ case: 'local_empty', remoteCount: 1000, localCount: 0 });

    await useSyncStore.getState().connect(URL, 'token', '/vault');

    const s = useSyncStore.getState();
    expect(mockApply).not.toHaveBeenCalled();
    expect(s.config.isConnected).toBe(false);
    expect(s.pendingConnect?.preview).toEqual({
      case: 'local_empty',
      remoteCount: 1000,
      localCount: 0,
    });
    expect(s.connecting).toBe(false);
  });

  it('TC-15c: confirmConnect applies the choice, then clears the dialog', async () => {
    mockPreview.mockResolvedValue({ case: 'local_empty', remoteCount: 5, localCount: 0 });
    mockApply.mockResolvedValue({ action: 'cloned', conflicts: [] });
    await useSyncStore.getState().connect(URL, 'token', '/vault');

    await useSyncStore.getState().confirmConnect('download');

    expect(mockApply).toHaveBeenCalledWith(URL, 'token', '/vault', 'download');
    const s = useSyncStore.getState();
    expect(s.pendingConnect).toBeNull();
    expect(s.config).toEqual({ repoUrl: URL, isConnected: true });
    expect(s.connectAction).toBe('cloned');
    expect(s.vaultChangeCount).toBe(1);
  });

  it('TC-15d: both sides with notes -> merge result surfaces conflict copies', async () => {
    mockPreview.mockResolvedValue({ case: 'both_have_content', remoteCount: 5, localCount: 3 });
    mockApply.mockResolvedValue({ action: 'merged', conflicts: ['a (conflicto 2026-10-18 23-05).md'] });
    await useSyncStore.getState().connect(URL, 'token', '/vault');

    await useSyncStore.getState().confirmConnect('sync');

    expect(useSyncStore.getState().conflicts).toEqual(['a (conflicto 2026-10-18 23-05).md']);
  });

  it('TC-15e: cancelConnect applies nothing and forgets the PAT', async () => {
    mockPreview.mockResolvedValue({ case: 'both_have_content', remoteCount: 5, localCount: 3 });
    await useSyncStore.getState().connect(URL, 'token', '/vault');

    useSyncStore.getState().cancelConnect();

    expect(mockApply).not.toHaveBeenCalled();
    const s = useSyncStore.getState();
    expect(s.pendingConnect).toBeNull();
    expect(s.config.isConnected).toBe(false);
  });

  it('TC-15f: connect sets error when the preview fails', async () => {
    mockPreview.mockRejectedValue('auth_failed');

    await useSyncStore.getState().connect(URL, 'bad', '/vault');

    const { error, config, pendingConnect } = useSyncStore.getState();
    expect(error).toBe('auth_failed');
    expect(config.isConnected).toBe(false);
    expect(pendingConnect).toBeNull();
  });

  // ─── sync events drive the store ──────────────────────────────────────────

  it('syncNow calls syncTrigger("manual")', async () => {
    mockTrigger.mockResolvedValue(undefined);

    await useSyncStore.getState().syncNow();

    expect(mockTrigger).toHaveBeenCalledWith('manual');
  });

  it('syncNow surfaces a failure as error', async () => {
    mockTrigger.mockRejectedValue({ kind: 'notConfigured' });

    await useSyncStore.getState().syncNow();

    expect(useSyncStore.getState().error).not.toBeNull();
  });

  it('applyFinished stores pendingConflicts and lastSuccess', () => {
    const payload = makeState({
      pendingConflicts: ['n (conflicto x).md'],
      lastSuccess: '2026-11-02T10:00:00Z',
    });

    useSyncStore.getState().applyFinished(payload);

    const s = useSyncStore.getState();
    expect(s.state?.pendingConflicts).toEqual(['n (conflicto x).md']);
    expect(s.state?.lastSuccess).toBe('2026-11-02T10:00:00Z');
    expect(s.conflicts).toEqual(['n (conflicto x).md']);
  });

  it('applyFinished bumps vaultChangeCount only when paths changed', () => {
    const report = { changedPaths: [], conflicts: [], needsConfirmation: null, pushed: true };
    useSyncStore.getState().applyFinished(makeState({ report }));
    expect(useSyncStore.getState().vaultChangeCount).toBe(0);

    useSyncStore.getState().applyFinished(makeState({ report: { ...report, changedPaths: ['a.md'] } }));
    expect(useSyncStore.getState().vaultChangeCount).toBe(1);
  });

  it('applyFinished keeps the deletion warning and derives hasChanges', () => {
    const report = {
      changedPaths: [],
      conflicts: [],
      needsConfirmation: { deleted: 15, total: 20 },
      pushed: false,
    };
    useSyncStore.getState().applyFinished(
      makeState({ report, pausedReason: 'deletion', status: { uncommitted: false, ahead: 2 } }),
    );

    const s = useSyncStore.getState();
    expect(s.pendingDeletion).toEqual({ deleted: 15, total: 20 });
    expect(s.status.hasChanges).toBe(true);

    // A later payload (e.g. reloaded state) must not lose the pending question.
    useSyncStore.getState().applyFinished(makeState({ pausedReason: 'deletion' }));
    expect(useSyncStore.getState().pendingDeletion).toEqual({ deleted: 15, total: 20 });

    useSyncStore.getState().applyFinished(makeState());
    expect(useSyncStore.getState().pendingDeletion).toBeNull();
  });

  it('confirmDeletion calls syncConfirmDeletions and clears the warning', async () => {
    useSyncStore.setState({ pendingDeletion: { deleted: 15, total: 20 } });
    mockConfirm.mockResolvedValue(undefined);

    await useSyncStore.getState().confirmDeletion();

    expect(mockConfirm).toHaveBeenCalledWith({ deleted: 15, total: 20 });
    expect(useSyncStore.getState().pendingDeletion).toBeNull();
  });

  it('confirmDeletion never confirms blindly when the counts are unknown', async () => {
    useSyncStore.setState({ pendingDeletion: null, deletionPromptOpen: true });

    await useSyncStore.getState().confirmDeletion();

    expect(mockConfirm).not.toHaveBeenCalled();
    expect(useSyncStore.getState().deletionPromptOpen).toBe(true);
  });

  it('cancelDeletion confirms nothing', () => {
    useSyncStore.setState({ pendingDeletion: { deleted: 15, total: 20 } });

    useSyncStore.getState().cancelDeletion();

    expect(mockConfirm).not.toHaveBeenCalled();
    expect(useSyncStore.getState().deletionPromptOpen).toBe(false);
    expect(useSyncStore.getState().pendingDeletion).toEqual({ deleted: 15, total: 20 });
  });

  it('opens the deletion prompt once per launch when paused without a report, and on demand', () => {
    useSyncStore.setState({ deletionPromptOpen: false, deletionPromptShown: false });
    useSyncStore.getState().applyFinished(makeState({ pausedReason: 'deletion' }));
    expect(useSyncStore.getState().deletionPromptOpen).toBe(true);
    useSyncStore.getState().cancelDeletion();
    useSyncStore.getState().applyFinished(makeState({ pausedReason: 'deletion' }));
    expect(useSyncStore.getState().deletionPromptOpen).toBe(false);
    useSyncStore.getState().openDeletionPrompt();
    expect(useSyncStore.getState().deletionPromptOpen).toBe(true);
    useSyncStore.getState().applyFinished(makeState());
    expect(useSyncStore.getState().deletionPromptOpen).toBe(false);
  });

  it('indicatorFor counts frontend-only conflict copies', () => {
    expect(indicatorFor(makeState(), false, ['a (conflicto x).md'])).toBe('needsReview');
  });

  it('maps sync errors to Spanish text', async () => {
    mockTrigger.mockRejectedValue({ kind: 'unauthorized', detail: 'x' });
    await useSyncStore.getState().syncNow();
    expect(useSyncStore.getState().error).toBe('Token de GitHub no válido o caducado');
    expect(syncErrorText({ kind: 'git', detail: 'boom' })).toBe('Error de git: boom');
    expect(syncErrorText({ kind: 'notConfigured' })).toBe('GitHub no está configurado');
  });

  it('dismissConflicts calls syncDismissConflicts and updates the state', async () => {
    useSyncStore.setState({ conflicts: ['n (conflicto x).md'] });
    mockDismiss.mockResolvedValue(makeState({ pendingConflicts: [] }));

    await useSyncStore.getState().dismissConflicts();

    expect(mockDismiss).toHaveBeenCalledTimes(1);
    expect(useSyncStore.getState().conflicts).toEqual([]);
    expect(useSyncStore.getState().state?.pendingConflicts).toEqual([]);
  });

  it('loadState stores what sync_get_state returns', async () => {
    mockGetState.mockResolvedValue(makeState({ lastSuccess: 'x' }));

    await useSyncStore.getState().loadState();

    expect(useSyncStore.getState().state?.lastSuccess).toBe('x');
  });

  describe('indicatorFor precedence', () => {
    it('upToDate when nothing is going on', () => {
      expect(indicatorFor(makeState(), false)).toBe('upToDate');
    });
    it('pending: uncommitted, ahead or an armed debounce', () => {
      expect(indicatorFor(makeState({ status: { uncommitted: true, ahead: 0 } }), false)).toBe('pending');
      expect(indicatorFor(makeState({ status: { uncommitted: false, ahead: 1 } }), false)).toBe('pending');
      expect(indicatorFor(makeState({}, { pendingDebounce: true }), false)).toBe('pending');
    });
    it('offline beats pending', () => {
      const s = makeState({ status: { uncommitted: true, ahead: 3 } }, { offline: true });
      expect(indicatorFor(s, false)).toBe('offline');
    });
    it('syncing beats offline', () => {
      expect(indicatorFor(makeState({}, { offline: true }), true)).toBe('syncing');
    });
    it('needsReview beats syncing: halted, paused or conflicts', () => {
      expect(indicatorFor(makeState({}, { halted: true }), true)).toBe('needsReview');
      expect(indicatorFor(makeState({}, { needsReview: true }), true)).toBe('needsReview');
      expect(indicatorFor(makeState({ pausedReason: 'deletion' }), true)).toBe('needsReview');
      expect(indicatorFor(makeState({ pendingConflicts: ['a.md'] }), true)).toBe('needsReview');
    });
  });

  // ─── TC-18: disconnect resets config ──────────────────────────────────────

  it('TC-18: disconnect invokes github_disconnect and resets config', async () => {
    // Pre-populate connected state
    useSyncStore.setState({
      config: { repoUrl: 'https://github.com/u/r', isConnected: true },
    });
    mockDisconnect.mockResolvedValue(undefined);

    await useSyncStore.getState().disconnect();

    expect(mockDisconnect).toHaveBeenCalled();
    const { config } = useSyncStore.getState();
    expect(config.isConnected).toBe(false);
    expect(config.repoUrl).toBeNull();
  });

  it('disconnect forgets the pause and the conflicts of the old connection', async () => {
    useSyncStore.setState({
      config: { repoUrl: 'https://github.com/u/r', isConnected: true },
      state: makeState({ pausedReason: 'deletion', pendingConflicts: ['a.md'] }),
      pendingDeletion: { deleted: 15, total: 20 },
      deletionPromptOpen: true,
      conflicts: ['a.md'],
      localConflicts: ['b.md'],
    });
    mockDisconnect.mockResolvedValue(undefined);

    await useSyncStore.getState().disconnect();

    const s = useSyncStore.getState();
    expect(s.state).toBeNull();
    expect(s.pendingDeletion).toBeNull();
    expect(s.deletionPromptOpen).toBe(false);
    expect(s.conflicts).toEqual([]);
    expect(s.localConflicts).toEqual([]);
  });

  // ─── loadConfig ───────────────────────────────────────────────────────────

  it('loadConfig sets connected state when URL exists', async () => {
    mockGetConfig.mockResolvedValue('https://github.com/u/r');

    await useSyncStore.getState().loadConfig();

    const { config } = useSyncStore.getState();
    expect(config.isConnected).toBe(true);
    expect(config.repoUrl).toBe('https://github.com/u/r');
  });

  it('loadConfig sets disconnected state when URL is null', async () => {
    mockGetConfig.mockResolvedValue(null);

    await useSyncStore.getState().loadConfig();

    const { config } = useSyncStore.getState();
    expect(config.isConnected).toBe(false);
    expect(config.repoUrl).toBeNull();
  });
});

describe('frontend conflict copies', () => {
  beforeEach(() => {
    useSyncStore.setState({ conflicts: [], localConflicts: [] });
  });

  it('addConflicts shows the copy without duplicates', () => {
    useSyncStore.getState().addConflicts(['a (conflicto x).md']);
    useSyncStore.getState().addConflicts(['a (conflicto x).md']);
    expect(useSyncStore.getState().conflicts).toEqual(['a (conflicto x).md']);
  });

  it('dismissConflicts clears frontend copies too', async () => {
    vi.mocked(syncDismissConflicts).mockResolvedValue(makeState());
    useSyncStore.getState().addConflicts(['a (conflicto x).md']);
    await useSyncStore.getState().dismissConflicts();
    expect(useSyncStore.getState().localConflicts).toEqual([]);
    useSyncStore.getState().applyFinished(makeState({ pendingConflicts: ['b.md'] }));
    expect(useSyncStore.getState().conflicts).toEqual(['b.md']);
  });
});
