import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the tauri lib so no real Tauri invoke is needed
vi.mock('../lib/tauri', () => ({
  githubConnectPreview: vi.fn(),
  githubConnectApply: vi.fn(),
  githubGetConfig: vi.fn(),
  githubDisconnect: vi.fn(),
  githubPush: vi.fn(),
  githubPull: vi.fn(),
  githubStatus: vi.fn(),
}));

import {
  githubConnectPreview,
  githubConnectApply,
  githubGetConfig,
  githubDisconnect,
  githubPush,
  githubPull,
  githubStatus,
} from '../lib/tauri';
import { useSyncStore } from './syncStore';

const mockPreview = vi.mocked(githubConnectPreview);
const mockApply = vi.mocked(githubConnectApply);
const mockGetConfig = vi.mocked(githubGetConfig);
const mockDisconnect = vi.mocked(githubDisconnect);
const mockPush = vi.mocked(githubPush);
const mockPull = vi.mocked(githubPull);
const mockStatus = vi.mocked(githubStatus);

describe('useSyncStore', () => {
  beforeEach(() => {
    // Reset store to initial state
    useSyncStore.setState({
      config: { repoUrl: null, isConnected: false },
      status: { hasChanges: false },
      isLoading: false,
      error: null,
      connectAction: null,
      pendingConnect: null,
      pendingDeletion: null,
      conflicts: [],
      vaultChangeCount: 0,
    });
    vi.clearAllMocks();
    // Default: status returns false (no changes)
    mockStatus.mockResolvedValue(false);
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
    expect(mockStatus).toHaveBeenCalled();
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
    expect(s.isLoading).toBe(false);
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

  // ─── TC-16: push invokes github_push then github_status ───────────────────

  it('TC-16: push invokes github_push then github_status', async () => {
    mockPush.mockResolvedValue({ conflicts: [], needsConfirmation: null });

    await useSyncStore.getState().push('/vault');

    expect(mockPush).toHaveBeenCalledWith(false);
    const pushIndex = vi.mocked(mockPush).mock.invocationCallOrder[0];
    const statusIndex = vi.mocked(mockStatus).mock.invocationCallOrder[0];
    expect(pushIndex).toBeDefined();
    expect(statusIndex).toBeDefined();
    expect(pushIndex).toBeLessThan(statusIndex);
  });

  it('TC-16b: a push that needs confirmation stores the warning and pushes nothing more', async () => {
    mockPush.mockResolvedValue({ conflicts: [], needsConfirmation: { deleted: 15, total: 20 } });

    await useSyncStore.getState().push('/vault');

    expect(useSyncStore.getState().pendingDeletion).toEqual({ deleted: 15, total: 20 });
    expect(mockPush).toHaveBeenCalledTimes(1);
  });

  it('TC-16c: confirmDeletion pushes again with confirmDeletions=true', async () => {
    useSyncStore.setState({ pendingDeletion: { deleted: 15, total: 20 } });
    mockPush.mockResolvedValue({ conflicts: [], needsConfirmation: null });

    await useSyncStore.getState().confirmDeletion('/vault');

    expect(mockPush).toHaveBeenCalledWith(true);
    expect(useSyncStore.getState().pendingDeletion).toBeNull();
  });

  it('TC-16d: cancelDeletion pushes nothing', () => {
    useSyncStore.setState({ pendingDeletion: { deleted: 15, total: 20 } });

    useSyncStore.getState().cancelDeletion();

    expect(mockPush).not.toHaveBeenCalled();
    expect(useSyncStore.getState().pendingDeletion).toBeNull();
  });

  // ─── TC-17: pull invokes github_pull then github_status ───────────────────

  it('TC-17: pull invokes github_pull then github_status', async () => {
    mockPull.mockResolvedValue({ conflicts: [], needsConfirmation: null });

    await useSyncStore.getState().pull('/vault');

    const pullIndex = vi.mocked(mockPull).mock.invocationCallOrder[0];
    const statusIndex = vi.mocked(mockStatus).mock.invocationCallOrder[0];
    expect(pullIndex).toBeDefined();
    expect(statusIndex).toBeDefined();
    expect(pullIndex).toBeLessThan(statusIndex);
    expect(useSyncStore.getState().vaultChangeCount).toBe(1);
  });

  it('TC-17b: pull exposes conflicts until dismissed', async () => {
    mockPull.mockResolvedValue({ conflicts: ['n (conflicto x).md'], needsConfirmation: null });

    await useSyncStore.getState().pull('/vault');
    expect(useSyncStore.getState().conflicts).toEqual(['n (conflicto x).md']);

    useSyncStore.getState().dismissConflicts();
    expect(useSyncStore.getState().conflicts).toEqual([]);
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

  // ─── checkStatus ──────────────────────────────────────────────────────────

  it('checkStatus updates hasChanges from github_status', async () => {
    mockStatus.mockResolvedValue(true);

    await useSyncStore.getState().checkStatus('/vault');

    expect(useSyncStore.getState().status.hasChanges).toBe(true);
  });

  it('checkStatus silently handles error', async () => {
    mockStatus.mockRejectedValue('not_configured');

    await expect(
      useSyncStore.getState().checkStatus('/vault'),
    ).resolves.toBeUndefined();
    expect(useSyncStore.getState().status.hasChanges).toBe(false);
  });
});
