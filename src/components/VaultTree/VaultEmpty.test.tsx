import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { invoke } from '@tauri-apps/api/core';
import { VaultEmpty } from './VaultEmpty';
import { useVaultStore } from '../../store/vaultStore';

const mockInvoke = vi.mocked(invoke);

beforeEach(() => {
  vi.clearAllMocks();
  useVaultStore.setState({ vaultPath: null, tree: [], isLoading: false, error: null });
});

describe('TC-01, TC-02: VaultEmpty', () => {
  it('TC-01: muestra el texto explicativo', () => {
    render(<VaultEmpty />);
    expect(
      screen.getByText(/nada por aquí todavía/i),
    ).toBeInTheDocument();
  });

  it('TC-01: clic en "Abrir bóveda" llama a openVault (invoke open_vault_dialog)', async () => {
    mockInvoke
      .mockResolvedValueOnce(null); // open_vault_dialog cancelled

    render(<VaultEmpty />);
    await userEvent.click(screen.getByTestId('open-vault-btn'));

    expect(mockInvoke).toHaveBeenCalledWith('open_vault_dialog');
  });
});
