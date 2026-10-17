import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { invoke } from '@tauri-apps/api/core';
import { RenameInput } from './RenameInput';
import { useVaultStore } from '../../store/vaultStore';
import type { VaultEntry } from '../../store/vaultStore';

const mockInvoke = vi.mocked(invoke);

const entry: VaultEntry = {
  name: 'nota.md',
  path: '/vault/nota.md',
  kind: 'file',
  file_type: 'md',
};

beforeEach(() => {
  vi.clearAllMocks();
  useVaultStore.setState({ vaultPath: '/vault', tree: [], isLoading: false, error: null });
});

describe('TC-11: RenameInput', () => {
  it('TC-11: Enter renombra y cierra el input', async () => {
    const onDone = vi.fn();
    mockInvoke
      .mockResolvedValueOnce('/vault/renombrado.md') // rename_entry
      .mockResolvedValueOnce([]); // list_vault_tree

    render(<RenameInput entry={entry} onDone={onDone} />);
    const input = screen.getByTestId('rename-input') as HTMLInputElement;

    fireEvent.change(input, { target: { value: 'renombrado.md' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(mockInvoke).toHaveBeenCalledWith('rename_entry', expect.objectContaining({ newName: 'renombrado.md' }));
  });

  it('TC-11: Escape cancela sin renombrar', async () => {
    const onDone = vi.fn();
    render(<RenameInput entry={entry} onDone={onDone} />);
    const input = screen.getByTestId('rename-input');

    fireEvent.keyDown(input, { key: 'Escape' });

    expect(onDone).toHaveBeenCalled();
    expect(mockInvoke).not.toHaveBeenCalled();
  });

  it('TC-21: already_exists muestra mensaje de error', async () => {
    const onDone = vi.fn();
    mockInvoke.mockRejectedValueOnce('already_exists');

    render(<RenameInput entry={entry} onDone={onDone} />);
    const input = screen.getByTestId('rename-input') as HTMLInputElement;

    fireEvent.change(input, { target: { value: 'renombrado.md' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    await waitFor(() =>
      expect(screen.getByTestId('rename-error')).toBeInTheDocument(),
    );
    expect(screen.getByTestId('rename-error').textContent).toMatch(/ya existe/i);
    expect(onDone).not.toHaveBeenCalled();
  });

  it('TC-21: io_error muestra mensaje genérico', async () => {
    const onDone = vi.fn();
    mockInvoke.mockRejectedValueOnce('io_error');

    render(<RenameInput entry={entry} onDone={onDone} />);
    const input = screen.getByTestId('rename-input') as HTMLInputElement;

    fireEvent.change(input, { target: { value: 'algo.md' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    await waitFor(() =>
      expect(screen.getByTestId('rename-error')).toBeInTheDocument(),
    );
    expect(screen.getByTestId('rename-error').textContent).toMatch(/error/i);
  });
});
