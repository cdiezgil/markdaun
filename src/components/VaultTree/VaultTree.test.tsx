import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { invoke } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { VaultTree } from './VaultTree';
import { useVaultStore } from '../../store/vaultStore';
import type { VaultEntry } from '../../store/vaultStore';
import React from 'react';

const mockInvoke = vi.mocked(invoke);
const mockGetCurrentWindow = vi.mocked(getCurrentWindow);

function wrap(ui: React.ReactElement) {
  return render(<MemoryRouter>{ui}</MemoryRouter>);
}

beforeEach(() => {
  vi.clearAllMocks();
  // Default: getCurrentWindow returns mock with onDragDropEvent
  mockGetCurrentWindow.mockReturnValue({
    onDragDropEvent: vi.fn().mockResolvedValue(() => {}),
  } as unknown as ReturnType<typeof getCurrentWindow>);
  useVaultStore.setState({ vaultPath: null, tree: [], isLoading: false, error: null });
});

const sampleTree: VaultEntry[] = [
  { name: 'nota.md', path: '/vault/nota.md', kind: 'file', file_type: 'md' },
];

describe('TC-01, TC-02: VaultTree sin bóveda', () => {
  it('TC-02: muestra VaultEmpty cuando vaultPath es null', () => {
    wrap(<VaultTree />);
    expect(screen.getByText(/nada por aquí todavía/i)).toBeInTheDocument();
    expect(screen.queryByTestId('vault-tree')).toBeNull();
  });
});

describe('TC-01: VaultTree con bóveda', () => {
  it('TC-01: muestra los nodos del árbol cuando hay bóveda', () => {
    useVaultStore.setState({ vaultPath: '/vault', tree: sampleTree });
    wrap(<VaultTree />);
    expect(screen.getByTestId('vault-tree')).toBeInTheDocument();
    expect(screen.getByTestId('tree-node-nota.md')).toBeInTheDocument();
  });
});

describe('TC-16: drag-drop importa ficheros', () => {
  it('TC-16: drop dispara importFiles y refreshTree', async () => {
    let capturedCallback: ((event: unknown) => void) | undefined; // eslint-disable-line @typescript-eslint/no-explicit-any
    mockGetCurrentWindow.mockReturnValue({
      onDragDropEvent: vi.fn((cb: (event: unknown) => void) => {
        capturedCallback = cb;
        return Promise.resolve(() => {});
      }),
    } as unknown as ReturnType<typeof getCurrentWindow>);

    useVaultStore.setState({ vaultPath: '/vault', tree: [] });
    mockInvoke
      .mockResolvedValueOnce(['/vault/foto.png']) // import_files
      .mockResolvedValueOnce(sampleTree); // list_vault_tree

    wrap(<VaultTree />);

    // Simulate drag-drop event
    await waitFor(() => expect(capturedCallback).toBeDefined());
    capturedCallback!({ payload: { type: 'drop', paths: ['/tmp/foto.png'] } });

    await waitFor(() =>
      expect(mockInvoke).toHaveBeenCalledWith(
        'import_files',
        expect.objectContaining({ source_paths: ['/tmp/foto.png'] }),
      ),
    );
  });
});
