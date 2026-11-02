import React from 'react';
import { render, screen } from '@testing-library/react';
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

  it('no push/pull buttons in SyncPanel', () => {
    makeSyncState({ hasChanges: true });
    render(<SyncPanel />);
    expect(screen.getByTestId('sync-panel')).toBeInTheDocument();
    expect(screen.queryByTestId('sync-push-btn')).toBeNull();
    expect(screen.queryByTestId('sync-pull-btn')).toBeNull();
    expect(screen.queryByTestId('sync-badge')).toBeNull();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('renders nothing when not connected', () => {
    makeSyncState({ isConnected: false });
    const { container } = render(<SyncPanel />);
    expect(container.querySelector('[data-testid="sync-panel"]')).toBeNull();
  });
});
