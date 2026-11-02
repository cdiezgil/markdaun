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
  syncNow: ReturnType<typeof vi.fn>;
}> = {}) {
  const defaults = {
    isConnected: true,
    hasChanges: false,
    isLoading: false,
    syncNow: vi.fn(),
  };
  const merged = { ...defaults, ...overrides };

  (mockUseSyncStore as unknown as ReturnType<typeof vi.fn>).mockImplementation((selector: (s: unknown) => unknown) => {
    const state = {
      config: { repoUrl: 'https://github.com/u/r', isConnected: merged.isConnected },
      status: { hasChanges: merged.hasChanges },
      state: { view: { running: merged.isLoading } },
      syncNow: merged.syncNow,
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

  it('push button asks for a sync', async () => {
    const syncNow = vi.fn();
    makeSyncState({ syncNow });
    render(<SyncPanel />);
    await userEvent.click(screen.getByTestId('sync-push-btn'));
    expect(syncNow).toHaveBeenCalledTimes(1);
  });

  it('pull button asks for a sync', async () => {
    const syncNow = vi.fn();
    makeSyncState({ syncNow });
    render(<SyncPanel />);
    await userEvent.click(screen.getByTestId('sync-pull-btn'));
    expect(syncNow).toHaveBeenCalledTimes(1);
  });
});
