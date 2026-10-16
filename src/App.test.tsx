import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { invoke } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { App } from './App';
import { useVaultStore } from './store/vaultStore';
import React from 'react';

const mockInvoke = vi.mocked(invoke);
const mockGetCurrentWindow = vi.mocked(getCurrentWindow);

beforeEach(() => {
  vi.clearAllMocks();
  mockGetCurrentWindow.mockReturnValue({
    onDragDropEvent: vi.fn().mockResolvedValue(() => {}),
    onCloseRequested: vi.fn().mockResolvedValue(() => {}),
    close: vi.fn().mockResolvedValue(undefined),
  } as unknown as ReturnType<typeof getCurrentWindow>);
  useVaultStore.setState({ vaultPath: null, tree: [], isLoading: false, error: null });
});

describe('TC-01: App renders without crash', () => {
  it('TC-01: renders_without_crash — mounts App without throwing', () => {
    mockInvoke.mockResolvedValue(null);
    expect(() => render(<App />)).not.toThrow();
  });

  it('TC-01: calls initVault (get_active_vault) on mount', async () => {
    mockInvoke.mockResolvedValue(null); // get_active_vault (called twice: loadVault + initVault)
    render(<App />);
    await waitFor(() =>
      expect(mockInvoke).toHaveBeenCalledWith('get_active_vault'),
    );
  });
});

describe('TC-03: App', () => {
  it('TC-03: llama a loadVault al montar', async () => {
    mockInvoke.mockResolvedValueOnce(null); // get_active_vault
    render(<App />);

    await waitFor(() =>
      expect(mockInvoke).toHaveBeenCalledWith('get_active_vault'),
    );
  });

  it('TC-03: VaultTree está en el DOM', () => {
    mockInvoke.mockResolvedValueOnce(null);
    render(<App />);
    // VaultEmpty is shown when no vault
    expect(screen.getByText(/nada por aquí todavía/i)).toBeInTheDocument();
  });
});
