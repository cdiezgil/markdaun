import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../lib/tauri', () => ({
  githubConnectPreview: vi.fn(),
  githubConnectApply: vi.fn(),
  githubGetConfig: vi.fn(),
  githubDisconnect: vi.fn(),
  githubPush: vi.fn(),
  githubPull: vi.fn(),
  githubStatus: vi.fn(),
}));

const navigate = vi.fn();
vi.mock('react-router-dom', async (orig) => ({
  ...(await orig<typeof import('react-router-dom')>()),
  useNavigate: () => navigate,
}));

import { SyncDialogs } from './SyncDialogs';
import { useSyncStore } from '../../store/syncStore';
import { useVaultStore } from '../../store/vaultStore';

const confirmConnect = vi.fn();
const cancelConnect = vi.fn();
const confirmDeletion = vi.fn();
const cancelDeletion = vi.fn();
const dismissConflicts = vi.fn();

function setup(partial: Partial<ReturnType<typeof useSyncStore.getState>>) {
  useSyncStore.setState({
    pendingConnect: null,
    pendingDeletion: null,
    conflicts: [],
    confirmConnect,
    cancelConnect,
    confirmDeletion,
    cancelDeletion,
    dismissConflicts,
    ...partial,
  });
  useVaultStore.setState({ vaultPath: '/vault' });
  return render(
    <MemoryRouter>
      <SyncDialogs />
    </MemoryRouter>,
  );
}

const pending = (c: 'local_empty' | 'both_have_content', remoteCount: number, localCount: number) => ({
  repoUrl: 'https://github.com/u/r',
  pat: 'p',
  vaultPath: '/vault',
  preview: { case: c, remoteCount, localCount },
});

describe('SyncDialogs', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders nothing when there is nothing to decide', () => {
    setup({});
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.queryByTestId('sync-conflicts')).toBeNull();
  });

  it('local empty + remote notes: offers to download, never to upload', async () => {
    setup({ pendingConnect: pending('local_empty', 1000, 0) });
    expect(screen.getByText(/El repositorio ya tiene 1000 notas/)).toBeInTheDocument();
    expect(screen.getByText(/¿Descargarlas en esta carpeta\?/)).toBeInTheDocument();
    await userEvent.click(screen.getByTestId('confirm-dialog-delete'));
    expect(confirmConnect).toHaveBeenCalledWith('download');
  });

  it('both have notes: explains the merge and keeps both versions', async () => {
    setup({ pendingConnect: pending('both_have_content', 12, 3) });
    expect(screen.getByText(/El repositorio ya tiene 12 notas y esta carpeta tiene 3/)).toBeInTheDocument();
    expect(screen.getByText(/se conservarán las dos versiones/)).toBeInTheDocument();
    await userEvent.click(screen.getByTestId('confirm-dialog-delete'));
    expect(confirmConnect).toHaveBeenCalledWith('sync');
  });

  it('Cancelar cancels the connect', async () => {
    setup({ pendingConnect: pending('both_have_content', 12, 3) });
    await userEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
    expect(cancelConnect).toHaveBeenCalled();
    expect(confirmConnect).not.toHaveBeenCalled();
  });

  it('deletion guard asks before deleting notes on GitHub', async () => {
    setup({ pendingDeletion: { deleted: 15, total: 20 } });
    expect(
      screen.getByText('Esta sincronización borraría 15 de 20 notas en GitHub. ¿Continuar?'),
    ).toBeInTheDocument();
    await userEvent.click(screen.getByTestId('confirm-dialog-delete'));
    expect(confirmDeletion).toHaveBeenCalledWith('/vault');
  });

  it('deletion guard: Cancelar pushes nothing', async () => {
    setup({ pendingDeletion: { deleted: 15, total: 20 } });
    await userEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
    expect(cancelDeletion).toHaveBeenCalled();
    expect(confirmDeletion).not.toHaveBeenCalled();
  });

  it('conflicts notice counts them and links to each copy', async () => {
    setup({ conflicts: ['a (conflicto 2026-10-18 23-05).md', 'Area/b (conflicto 2026-10-18 23-05).md'] });
    expect(screen.getByText('Hay 2 conflictos')).toBeInTheDocument();
    await userEvent.click(screen.getByText('Area/b (conflicto 2026-10-18 23-05).md'));
    expect(navigate).toHaveBeenCalledWith(
      `/editor/${encodeURIComponent('/vault/Area/b (conflicto 2026-10-18 23-05).md')}`,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Cerrar' }));
    expect(dismissConflicts).toHaveBeenCalled();
  });

  it('singular wording for one conflict', () => {
    setup({ conflicts: ['a (conflicto x).md'] });
    expect(screen.getByText('Hay 1 conflicto')).toBeInTheDocument();
  });
});
