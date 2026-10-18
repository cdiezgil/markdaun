import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { invoke } from '@tauri-apps/api/core';
import { Trash } from './Trash';
import { useVaultStore } from '../../store/vaultStore';
import type { TrashItem } from '../../lib/tauri';

const mockInvoke = vi.mocked(invoke);

const items: TrashItem[] = [
  { id: '2', name: 'acta.md', original_path: 'Entrada/acta.md', deleted_ms: Date.UTC(2026, 9, 18, 12), size: 2048 },
  { id: '1', name: 'foto.png', original_path: 'Entrada/foto.png', deleted_ms: Date.UTC(2026, 9, 17, 12), size: 10 },
];

function backend(list: TrashItem[] = items) {
  let current = [...list];
  mockInvoke.mockImplementation((async (cmd: string, args: { id?: string }) => {
    if (cmd === 'trash_list') return current;
    if (cmd === 'trash_restore') {
      current = current.filter((i) => i.id !== args.id);
      return '/v/Entrada/acta.md';
    }
    if (cmd === 'trash_delete') {
      current = current.filter((i) => i.id !== args.id);
      return undefined;
    }
    return undefined;
  }) as never);
}

beforeEach(() => {
  vi.clearAllMocks();
  useVaultStore.setState({ vaultPath: '/v', tree: [], refreshTree: vi.fn() } as never);
});

describe('Trash (Papelera)', () => {
  it('lists the discarded items with where they came from', async () => {
    backend();
    render(<Trash />);
    expect(screen.getByRole('heading', { name: 'Papelera' })).toBeInTheDocument();
    const row = await screen.findByTestId('trash-item-2');
    expect(row).toHaveTextContent('acta.md');
    expect(row).toHaveTextContent('Entrada/acta.md');
    expect(screen.getByTestId('trash-item-1')).toBeInTheDocument();
  });

  it('shows an empty state', async () => {
    backend([]);
    render(<Trash />);
    expect(await screen.findByText(/la papelera está vacía/i)).toBeInTheDocument();
  });

  it('restores an item and refreshes the vault tree', async () => {
    backend();
    render(<Trash />);
    fireEvent.click(await screen.findByTestId('restore-2'));
    await waitFor(() => expect(screen.queryByTestId('trash-item-2')).toBeNull());
    expect(mockInvoke).toHaveBeenCalledWith('trash_restore', { id: '2', vaultPath: '/v' });
    expect(useVaultStore.getState().refreshTree).toHaveBeenCalled();
  });

  it('asks before deleting permanently', async () => {
    backend();
    render(<Trash />);
    fireEvent.click(await screen.findByTestId('delete-1'));
    expect(mockInvoke).not.toHaveBeenCalledWith('trash_delete', expect.anything());
    fireEvent.click(await screen.findByRole('button', { name: 'Eliminar definitivamente' }));
    await waitFor(() => expect(screen.queryByTestId('trash-item-1')).toBeNull());
    expect(mockInvoke).toHaveBeenCalledWith('trash_delete', { id: '1', vaultPath: '/v' });
    expect(screen.getByTestId('trash-item-2')).toBeInTheDocument();
  });

  it('cancelling the confirmation keeps the item', async () => {
    backend();
    render(<Trash />);
    fireEvent.click(await screen.findByTestId('delete-1'));
    fireEvent.click(await screen.findByRole('button', { name: /cancelar/i }));
    expect(mockInvoke).not.toHaveBeenCalledWith('trash_delete', expect.anything());
    expect(screen.getByTestId('trash-item-1')).toBeInTheDocument();
  });
});
