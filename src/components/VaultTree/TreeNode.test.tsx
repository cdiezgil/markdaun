import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { invoke } from '@tauri-apps/api/core';
import { TreeNode } from './TreeNode';
import { useVaultStore } from '../../store/vaultStore';
import type { VaultEntry } from '../../store/vaultStore';
import React from 'react';

const mockInvoke = vi.mocked(invoke);
const mockNavigate = vi.fn();

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>(
    'react-router-dom',
  );
  return { ...actual, useNavigate: () => mockNavigate };
});

function wrap(ui: React.ReactElement) {
  return render(<MemoryRouter>{ui}</MemoryRouter>);
}

beforeEach(() => {
  vi.clearAllMocks();
  useVaultStore.setState({ vaultPath: '/vault', tree: [], isLoading: false, error: null });
});

const mdEntry: VaultEntry = {
  name: 'nota.md',
  path: '/vault/nota.md',
  kind: 'file',
  file_type: 'md',
};
const imgEntry: VaultEntry = {
  name: 'foto.png',
  path: '/vault/foto.png',
  kind: 'file',
  file_type: 'image',
};
const otherEntry: VaultEntry = {
  name: 'script.py',
  path: '/vault/script.py',
  kind: 'file',
  file_type: 'other',
};

describe('TC-06: clic en .md navega a /editor', () => {
  it('TC-06: click en nota.md navega a /editor/<encodedPath>', () => {
    wrap(<TreeNode entry={mdEntry} depth={0} />);
    fireEvent.click(screen.getByTestId('tree-node-nota.md'));
    expect(mockNavigate).toHaveBeenCalledWith(
      `/editor/${encodeURIComponent('/vault/nota.md')}`,
    );
  });
});

describe('TC-07: clic en imagen navega a /preview', () => {
  it('TC-07: click en foto.png navega a /preview/<encodedPath>', () => {
    wrap(<TreeNode entry={imgEntry} depth={0} />);
    fireEvent.click(screen.getByTestId('tree-node-foto.png'));
    expect(mockNavigate).toHaveBeenCalledWith(
      `/preview/${encodeURIComponent('/vault/foto.png')}`,
    );
  });
});

describe('TC-08: clic en other no navega', () => {
  it('TC-08: click en script.py no llama a navigate', () => {
    wrap(<TreeNode entry={otherEntry} depth={0} />);
    fireEvent.click(screen.getByTestId('tree-node-script.py'));
    expect(mockNavigate).not.toHaveBeenCalled();
  });
});

describe('TC-18: colores por tipo de fichero', () => {
  it('TC-18: .md tiene color var(--daun)', () => {
    wrap(<TreeNode entry={mdEntry} depth={0} />);
    const nameSpan = screen.getByTestId('tree-node-name-nota.md');
    expect(nameSpan.style.color).toBe('var(--daun)');
  });

  it('TC-18: imagen tiene color var(--ink)', () => {
    wrap(<TreeNode entry={imgEntry} depth={0} />);
    const nameSpan = screen.getByTestId('tree-node-name-foto.png');
    expect(nameSpan.style.color).toBe('var(--ink)');
  });

  it('TC-18: other tiene color var(--ink-muted)', () => {
    wrap(<TreeNode entry={otherEntry} depth={0} />);
    const nameSpan = screen.getByTestId('tree-node-name-script.py');
    expect(nameSpan.style.color).toBe('var(--ink-muted)');
  });
});

describe('TC-11: doble clic muestra RenameInput', () => {
  it('TC-11: dblclick en nodo muestra input de renombrado', () => {
    wrap(<TreeNode entry={mdEntry} depth={0} />);
    fireEvent.dblClick(screen.getByTestId('tree-node-nota.md'));
    expect(screen.getByTestId('rename-input')).toBeInTheDocument();
  });
});

describe('TC-13: menú contextual', () => {
  it('TC-18: clic derecho muestra menú contextual', () => {
    wrap(<TreeNode entry={mdEntry} depth={0} />);
    fireEvent.contextMenu(screen.getByTestId('tree-node-nota.md'));
    expect(screen.getByTestId('context-menu')).toBeInTheDocument();
    expect(screen.getByTestId('context-rename')).toBeInTheDocument();
    expect(screen.getByTestId('context-delete')).toBeInTheDocument();
  });

  it('TC-13: clic en Eliminar muestra ConfirmDialog', async () => {
    wrap(<TreeNode entry={mdEntry} depth={0} />);
    fireEvent.contextMenu(screen.getByTestId('tree-node-nota.md'));
    await userEvent.click(screen.getByTestId('context-delete'));
    expect(screen.getByTestId('confirm-dialog-overlay')).toBeInTheDocument();
  });

  it('TC-13: confirmar eliminar llama deleteEntry y refreshTree', async () => {
    mockInvoke
      .mockResolvedValueOnce(undefined) // delete_entry
      .mockResolvedValueOnce([]); // list_vault_tree

    wrap(<TreeNode entry={mdEntry} depth={0} />);
    fireEvent.contextMenu(screen.getByTestId('tree-node-nota.md'));
    await userEvent.click(screen.getByTestId('context-delete'));
    await userEvent.click(screen.getByTestId('confirm-dialog-delete'));

    await waitFor(() =>
      expect(mockInvoke).toHaveBeenCalledWith('delete_entry', expect.objectContaining({ path: '/vault/nota.md' })),
    );
  });
});

describe('TC-05: carpeta toggle', () => {
  it('TC-05: clic en carpeta expande hijos', () => {
    const folder: VaultEntry = {
      name: 'sub',
      path: '/vault/sub',
      kind: 'folder',
      children: [mdEntry],
    };
    wrap(<TreeNode entry={folder} depth={0} />);
    fireEvent.click(screen.getByTestId('tree-node-sub'));
    expect(screen.getByTestId('tree-node-nota.md')).toBeInTheDocument();
  });
});

const folderEntry: VaultEntry = {
  name: 'carpeta',
  path: '/vault/carpeta',
  kind: 'folder',
  children: [],
};

describe('drag & drop entre nodos', () => {
  function makeDataTransfer(getDataValue: string) {
    return {
      types: ['application/x-markdaun-entry'],
      setData: vi.fn(),
      getData: vi.fn().mockReturnValue(getDataValue),
      effectAllowed: '',
      dropEffect: '',
    };
  }

  it('dragStart guarda la ruta de la entrada en el dataTransfer', () => {
    wrap(<TreeNode entry={mdEntry} depth={0} />);
    const dt = makeDataTransfer('');
    fireEvent.dragStart(screen.getByTestId('tree-node-nota.md'), { dataTransfer: dt });
    expect(dt.setData).toHaveBeenCalledWith(
      'application/x-markdaun-entry',
      '/vault/nota.md',
    );
  });

  it('soltar una nota sobre una carpeta invoca move_entry', async () => {
    mockInvoke
      .mockResolvedValueOnce('/vault/carpeta/nota.md') // move_entry
      .mockResolvedValueOnce([]); // list_vault_tree

    wrap(<TreeNode entry={folderEntry} depth={0} />);
    fireEvent.drop(screen.getByTestId('tree-node-carpeta'), {
      dataTransfer: makeDataTransfer('/vault/nota.md'),
    });

    await waitFor(() =>
      expect(mockInvoke).toHaveBeenCalledWith(
        'move_entry',
        expect.objectContaining({
          sourcePath: '/vault/nota.md',
          destFolderPath: '/vault/carpeta',
        }),
      ),
    );
  });

  it('no hace nada al soltar una carpeta sobre sí misma', () => {
    wrap(<TreeNode entry={folderEntry} depth={0} />);
    fireEvent.drop(screen.getByTestId('tree-node-carpeta'), {
      dataTransfer: makeDataTransfer('/vault/carpeta'),
    });
    expect(mockInvoke).not.toHaveBeenCalled();
  });

  it('ignora drops sin payload de entrada', () => {
    wrap(<TreeNode entry={folderEntry} depth={0} />);
    fireEvent.drop(screen.getByTestId('tree-node-carpeta'), {
      dataTransfer: { types: ['Files'], getData: vi.fn() },
    });
    expect(mockInvoke).not.toHaveBeenCalled();
  });

  it('un fichero no acepta drops', () => {
    wrap(<TreeNode entry={mdEntry} depth={0} />);
    fireEvent.drop(screen.getByTestId('tree-node-nota.md'), {
      dataTransfer: makeDataTransfer('/vault/otra.md'),
    });
    expect(mockInvoke).not.toHaveBeenCalled();
  });
});

describe('menú contextual de carpeta', () => {
  it('muestra Nueva nota y Nueva carpeta solo en carpetas', async () => {
    const onCreateNote = vi.fn();
    const onCreateFolder = vi.fn();
    wrap(
      <TreeNode
        entry={folderEntry}
        depth={0}
        onCreateNote={onCreateNote}
        onCreateFolder={onCreateFolder}
      />,
    );

    fireEvent.contextMenu(screen.getByTestId('tree-node-carpeta'));
    fireEvent.click(await screen.findByTestId('context-new-note'));
    expect(onCreateNote).toHaveBeenCalledWith('/vault/carpeta');

    fireEvent.contextMenu(screen.getByTestId('tree-node-carpeta'));
    fireEvent.click(await screen.findByTestId('context-new-folder'));
    expect(onCreateFolder).toHaveBeenCalledWith('/vault/carpeta');
  });

  it('no muestra opciones de creación en ficheros', () => {
    wrap(<TreeNode entry={mdEntry} depth={0} onCreateNote={vi.fn()} onCreateFolder={vi.fn()} />);
    fireEvent.contextMenu(screen.getByTestId('tree-node-nota.md'));
    expect(screen.queryByTestId('context-new-note')).toBeNull();
    expect(screen.queryByTestId('context-new-folder')).toBeNull();
  });
});
