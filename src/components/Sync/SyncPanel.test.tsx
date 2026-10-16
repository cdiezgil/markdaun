import React from 'react';
import { render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SyncPanel } from './SyncPanel';

vi.mock('../../store/syncStore', () => ({
  useSyncStore: vi.fn(),
}));
vi.mock('../../store/vaultStore', () => ({
  useVaultStore: vi.fn(),
}));

import { useSyncStore } from '../../store/syncStore';
import { useVaultStore } from '../../store/vaultStore';

const mockUseSyncStore = vi.mocked(useSyncStore);
const mockUseVaultStore = vi.mocked(useVaultStore);

function makeSyncState(overrides: Partial<{
  isConnected: boolean;
  hasChanges: boolean;
  isLoading: boolean;
  push: ReturnType<typeof vi.fn>;
  pull: ReturnType<typeof vi.fn>;
}> = {}) {
  const defaults = {
    isConnected: true,
    hasChanges: false,
    isLoading: false,
    push: vi.fn(),
    pull: vi.fn(),
  };
  const merged = { ...defaults, ...overrides };

  (mockUseSyncStore as unknown as ReturnType<typeof vi.fn>).mockImplementation((selector: (s: unknown) => unknown) => {
    const state = {
      config: { repoUrl: 'https://github.com/u/r', isConnected: merged.isConnected },
      status: { hasChanges: merged.hasChanges },
      isLoading: merged.isLoading,
      push: merged.push,
      pull: merged.pull,
    };
    return selector(state);
  });
  (mockUseVaultStore as unknown as ReturnType<typeof vi.fn>).mockImplementation(
    (selector: (s: unknown) => unknown) => selector({ vaultPath: '/vault' }),
  );
}

describe('SyncPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ─── TC-19: badge visible when hasChanges=true ────────────────────────────

  it('TC-19: shows amber badge when hasChanges is true', () => {
    makeSyncState({ hasChanges: true });
    render(<SyncPanel />);
    expect(screen.getByTestId('sync-badge')).toBeDefined();
  });

  // ─── TC-20: badge not visible when hasChanges=false ───────────────────────

  it('TC-20: hides badge when hasChanges is false', () => {
    makeSyncState({ hasChanges: false });
    render(<SyncPanel />);
    expect(screen.queryByTestId('sync-badge')).toBeNull();
  });

  // ─── TC-21: push button disabled when isLoading=true ─────────────────────

  it('TC-21: push button is disabled when isLoading', () => {
    makeSyncState({ isLoading: true });
    render(<SyncPanel />);
    const btn = screen.getByTestId('sync-push-btn') as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
  });

  // ─── TC-22: pull button disabled when isLoading=true ─────────────────────

  it('TC-22: pull button is disabled when isLoading', () => {
    makeSyncState({ isLoading: true });
    render(<SyncPanel />);
    const btn = screen.getByTestId('sync-pull-btn') as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
  });

  it('renders nothing when not connected', () => {
    makeSyncState({ isConnected: false });
    const { container } = render(<SyncPanel />);
    expect(container.querySelector('[data-testid="sync-panel"]')).toBeNull();
  });

  it('calls push with vaultPath on push button click', async () => {
    const pushFn = vi.fn();
    makeSyncState({ push: pushFn });
    render(<SyncPanel />);
    await userEvent.click(screen.getByTestId('sync-push-btn'));
    expect(pushFn).toHaveBeenCalledWith('/vault');
  });

  it('calls pull with vaultPath on pull button click', async () => {
    const pullFn = vi.fn();
    makeSyncState({ pull: pullFn });
    render(<SyncPanel />);
    await userEvent.click(screen.getByTestId('sync-pull-btn'));
    expect(pullFn).toHaveBeenCalledWith('/vault');
  });
});
