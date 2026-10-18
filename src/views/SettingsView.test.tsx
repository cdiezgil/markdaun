import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SettingsView } from './SettingsView';

vi.mock('../store/syncStore', () => ({ useSyncStore: vi.fn() }));
vi.mock('../store/vaultStore', () => ({ useVaultStore: vi.fn() }));
vi.mock('../components/Settings/Trash', () => ({ Trash: () => <div data-testid="trash-section" /> }));

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

  // ─── TC-25/26: connect only previews; the decision dialog lives in <SyncDialogs /> ──

  it.each([
    ['vault with notes', true],
    ['empty vault', false],
  ])('TC-25: Conectar with %s asks the store to preview, with no overwrite dialog', (_n, hasFiles) => {
    makeState({ isConnected: false, hasFiles });
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

describe('Papelera en Ajustes', () => {
  it('incluye la sección Papelera', () => {
    makeState();
    render(<SettingsView />);
    expect(screen.getByTestId('trash-section')).toBeInTheDocument();
  });
});
