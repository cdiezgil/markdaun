import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the tauri lib so no real Tauri invoke is needed
vi.mock('../lib/tauri', () => ({
  githubConfigure: vi.fn(),
  githubGetConfig: vi.fn(),
  githubDisconnect: vi.fn(),
  githubPush: vi.fn(),
  githubPull: vi.fn(),
  githubStatus: vi.fn(),
}));

import {
  githubConfigure,
  githubGetConfig,
  githubDisconnect,
  githubPush,
  githubPull,
  githubStatus,
} from '../lib/tauri';
import { useSyncStore } from './syncStore';

const mockConfigure = vi.mocked(githubConfigure);
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
    });
    vi.clearAllMocks();
    // Default: status returns false (no changes)
    mockStatus.mockResolvedValue(false);
  });

  // ─── TC-15: connect invokes configure then status ─────────────────────────

  it('TC-15: connect invokes github_configure then github_status', async () => {
    mockConfigure.mockResolvedValue('pushed');

    await useSyncStore.getState().connect('https://github.com/u/r', 'token', '/vault');

    expect(mockConfigure).toHaveBeenCalledWith(
      'https://github.com/u/r',
      'token',
      '/vault',
    );
    expect(mockStatus).toHaveBeenCalled();
  });

  it('TC-15b: connect sets isConnected=true and connectAction on success', async () => {
    mockConfigure.mockResolvedValue('cloned');

    await useSyncStore.getState().connect('https://github.com/u/r', 'pat', '/vault');

    const { config, connectAction } = useSyncStore.getState();
    expect(config.isConnected).toBe(true);
    expect(config.repoUrl).toBe('https://github.com/u/r');
    expect(connectAction).toBe('cloned');
  });

  it('TC-15c: connect sets error on failure', async () => {
    mockConfigure.mockRejectedValue('auth_failed');

    await useSyncStore.getState().connect('https://github.com/u/r', 'bad', '/vault');

    const { error, config } = useSyncStore.getState();
    expect(error).toBe('auth_failed');
    expect(config.isConnected).toBe(false);
  });

  // ─── TC-16: push invokes github_push then github_status ───────────────────

  it('TC-16: push invokes github_push then github_status', async () => {
    mockPush.mockResolvedValue(undefined);

    await useSyncStore.getState().push('/vault');

    const pushIndex = vi
      .mocked(mockPush)
      .mock.invocationCallOrder[0];
    const statusIndex = vi
      .mocked(mockStatus)
      .mock.invocationCallOrder[0];
    expect(pushIndex).toBeDefined();
    expect(statusIndex).toBeDefined();
    expect(pushIndex).toBeLessThan(statusIndex);
  });

  // ─── TC-17: pull invokes github_pull then github_status ───────────────────

  it('TC-17: pull invokes github_pull then github_status', async () => {
    mockPull.mockResolvedValue(undefined);

    await useSyncStore.getState().pull('/vault');

    const pullIndex = vi
      .mocked(mockPull)
      .mock.invocationCallOrder[0];
    const statusIndex = vi
      .mocked(mockStatus)
      .mock.invocationCallOrder[0];
    expect(pullIndex).toBeDefined();
    expect(statusIndex).toBeDefined();
    expect(pullIndex).toBeLessThan(statusIndex);
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
