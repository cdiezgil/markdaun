import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SettingsView } from './SettingsView';

vi.mock('../store/syncStore', () => ({ useSyncStore: vi.fn() }));
vi.mock('../store/vaultStore', () => ({ useVaultStore: vi.fn() }));

import { useSyncStore } from '../store/syncStore';
import { useVaultStore } from '../store/vaultStore';

const mockUseSyncStore = vi.mocked(useSyncStore);
const mockUseVaultStore = vi.mocked(useVaultStore);

const connectFn = vi.fn();
const disconnectFn = vi.fn();

function makeState({
  isConnected = false,
  repoUrl = null as string | null,
  hasFiles = false,
} = {}) {
  (mockUseSyncStore as unknown as ReturnType<typeof vi.fn>).mockImplementation(
    (selector: (s: unknown) => unknown) =>
      selector({
        config: { repoUrl, isConnected },
        status: { hasChanges: false },
        isLoading: false,
        error: null,
        connectAction: null,
        connect: connectFn,
        disconnect: disconnectFn,
      }),
  );
  (mockUseVaultStore as unknown as ReturnType<typeof vi.fn>).mockImplementation(
    (selector: (s: unknown) => unknown) =>
      selector({
        vaultPath: '/vault',
        tree: hasFiles ? [{ name: 'note.md', path: '/vault/note.md', kind: 'file' }] : [],
      }),
  );
}

describe('SettingsView', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ─── TC-23: form visible when not connected ───────────────────────────────

  it('TC-23: shows connection form when not connected', () => {
    makeState({ isConnected: false });
    render(<SettingsView />);
    expect(screen.getByTestId('github-url-input')).toBeDefined();
    expect(screen.getByTestId('github-pat-input')).toBeDefined();
    expect(screen.getByTestId('github-connect-btn')).toBeDefined();
  });

  // ─── TC-24: URL and disconnect button visible when connected ──────────────

  it('TC-24: shows URL and disconnect button when connected', () => {
    makeState({ isConnected: true, repoUrl: 'https://github.com/u/r' });
    render(<SettingsView />);
    expect(screen.getByTestId('github-disconnect-btn')).toBeDefined();
    expect(screen.getByText(/https:\/\/github\.com\/u\/r/)).toBeDefined();
  });

  // ─── TC-25: vault with files shows ConfirmDialog on connect ──────────────

  it('TC-25: shows ConfirmDialog when vault has files and user clicks Conectar', () => {
    makeState({ isConnected: false, hasFiles: true });
    render(<SettingsView />);

    // Fill in form
    fireEvent.change(screen.getByTestId('github-url-input'), {
      target: { value: 'https://github.com/u/r' },
    });
    fireEvent.change(screen.getByTestId('github-pat-input'), {
      target: { value: 'ghp_token' },
    });
    fireEvent.click(screen.getByTestId('github-connect-btn'));

    // ConfirmDialog overlay should appear
    expect(screen.getByTestId('confirm-dialog-overlay')).toBeDefined();
  });

  // ─── TC-26: empty vault calls connect directly without dialog ─────────────

  it('TC-26: calls connect directly when vault is empty (no ConfirmDialog)', () => {
    makeState({ isConnected: false, hasFiles: false });
    render(<SettingsView />);

    fireEvent.change(screen.getByTestId('github-url-input'), {
      target: { value: 'https://github.com/u/r' },
    });
    fireEvent.change(screen.getByTestId('github-pat-input'), {
      target: { value: 'ghp_token' },
    });
    fireEvent.click(screen.getByTestId('github-connect-btn'));

    expect(connectFn).toHaveBeenCalledWith('https://github.com/u/r', 'ghp_token', '/vault');
    expect(screen.queryByTestId('confirm-dialog-overlay')).toBeNull();
  });

  // ─── TC-27: disconnect shows destructive ConfirmDialog ───────────────────

  it('TC-27: shows ConfirmDialog with Desvincular label on disconnect click', () => {
    makeState({ isConnected: true, repoUrl: 'https://github.com/u/r' });
    render(<SettingsView />);

    fireEvent.click(screen.getByTestId('github-disconnect-btn'));

    const overlay = screen.getByTestId('confirm-dialog-overlay');
    expect(overlay).toBeDefined();
    // The confirm button should show "Desvincular"
    const confirmBtn = screen.getByTestId('confirm-dialog-delete');
    expect(confirmBtn.textContent).toBe('Desvincular');
  });
});
