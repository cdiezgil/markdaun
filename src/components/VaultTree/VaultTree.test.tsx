import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { invoke } from '@tauri-apps/api/core';
import { VaultTree } from './VaultTree';
import { useVaultStore } from '../../store/vaultStore';
import type { VaultEntry } from '../../store/vaultStore';
import React from 'react';

const mockInvoke = vi.mocked(invoke);

function wrap(ui: React.ReactElement) {
  return render(<MemoryRouter>{ui}</MemoryRouter>);
}

beforeEach(() => {
  vi.clearAllMocks();
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

describe('shell sidebar', () => {
  const tree: VaultEntry[] = [
    {
      name: 'Test',
      path: '/vault/Test',
      kind: 'folder',
      children: [{ name: 'a.md', path: '/vault/Test/a.md', kind: 'file', file_type: 'md' }],
    },
    { name: 'b.md', path: '/vault/b.md', kind: 'file', file_type: 'md' },
    { name: 'c.md', path: '/vault/c.md', kind: 'file', file_type: 'md' },
  ];

  it('shows the BÓVEDA header label with new note / new folder buttons', () => {
    useVaultStore.setState({ vaultPath: '/vault', tree });
    wrap(<VaultTree />);
    const label = screen.getByText('Bóveda');
    expect(label.style.textTransform).toBe('uppercase');
    expect(label.style.letterSpacing).toBe('0.04em');
    expect(screen.getByTestId('new-note-btn')).toHaveAccessibleName('Nueva nota');
    expect(screen.getByTestId('new-folder-btn')).toHaveAccessibleName('Nueva carpeta');
  });

  it('footer shows note and folder counts and the settings link', () => {
    useVaultStore.setState({ vaultPath: '/vault', tree });
    wrap(<VaultTree />);
    const footer = screen.getByTestId('vault-footer');
    expect(footer).toHaveTextContent('3 notas · 1 carpeta');
    expect(footer.style.borderTop).toBe('1px solid var(--line)');
    const settings = screen.getByTestId('settings-link');
    expect(footer).toContainElement(settings);
    expect(settings).toHaveAttribute('href', '/settings');
    expect(settings).toHaveAccessibleName('Ajustes');
  });
});

describe('TC-16: drop de ficheros externos importa al vault', () => {
  function makeFileDrop(files: File[]) {
    return {
      types: ['Files'],
      setData: vi.fn(),
      getData: vi.fn().mockReturnValue(''),
      files,
      effectAllowed: '',
      dropEffect: '',
    };
  }

  it('TC-16: soltar ficheros del SO en el árbol invoca import_file_data por fichero', async () => {
    useVaultStore.setState({ vaultPath: '/vault', tree: [] });
    const file = new File([new Uint8Array([1, 2, 3])], 'foto.png');
    mockInvoke
      .mockResolvedValueOnce('/vault/foto.png') // import_file_data
      .mockResolvedValueOnce(sampleTree); // list_vault_tree

    wrap(<VaultTree />);
    fireEvent.drop(screen.getByTestId('vault-tree-scroll'), {
      dataTransfer: makeFileDrop([file]),
    });

    await waitFor(() =>
      expect(mockInvoke).toHaveBeenCalledWith(
        'import_file_data',
        expect.objectContaining({ fileName: 'foto.png', contents: [1, 2, 3] }),
      ),
    );
  });

  it('un drop interno (mover entrada) no dispara la importación', async () => {
    useVaultStore.setState({ vaultPath: '/vault', tree: [] });
    mockInvoke
      .mockResolvedValueOnce('/vault/nota.md') // move_entry
      .mockResolvedValueOnce(sampleTree); // list_vault_tree

    wrap(<VaultTree />);
    fireEvent.drop(screen.getByTestId('vault-tree-scroll'), {
      dataTransfer: {
        types: ['application/x-markdaun-entry'],
        setData: vi.fn(),
        getData: vi.fn().mockReturnValue('/carpeta/nota.md'),
        files: [],
        effectAllowed: '',
        dropEffect: '',
      },
    });

    await waitFor(() =>
      expect(mockInvoke).toHaveBeenCalledWith(
        'move_entry',
        expect.objectContaining({ sourcePath: '/carpeta/nota.md' }),
      ),
    );
    expect(mockInvoke).not.toHaveBeenCalledWith('import_file_data', expect.anything());
  });
});

function Where() {
  return <div data-testid="where">{decodeURIComponent(useLocation().pathname)}</div>;
}

describe('nueva nota sin nombre', () => {
  beforeEach(() => {
    useVaultStore.setState({ selectedFolder: null });
    mockInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === 'create_untitled_note') return '/vault/Sin título.md';
      if (cmd === 'list_vault_tree') return sampleTree;
      return undefined;
    });
  });

  it('crea Sin título en la raíz sin abrir diálogo y abre la nota', async () => {
    useVaultStore.setState({ vaultPath: '/vault', tree: [] });
    render(
      <MemoryRouter>
        <Where />
        <VaultTree />
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByTestId('new-note-btn'));

    await waitFor(() =>
      expect(mockInvoke).toHaveBeenCalledWith('create_untitled_note', {
        parentPath: '/vault',
        vaultPath: '/vault',
      }),
    );
    expect(screen.queryByTestId('name-dialog-overlay')).toBeNull();
    await waitFor(() =>
      expect(screen.getByTestId('where')).toHaveTextContent('/editor//vault/Sin título.md'),
    );
  });

  it('crea en la carpeta seleccionada', async () => {
    useVaultStore.setState({
      vaultPath: '/vault',
      tree: [{ name: 'dir', path: '/vault/dir', kind: 'folder', children: [] }],
    });
    wrap(<VaultTree />);
    fireEvent.click(screen.getByTestId('tree-node-dir'));
    fireEvent.click(screen.getByTestId('new-note-btn'));

    await waitFor(() =>
      expect(mockInvoke).toHaveBeenCalledWith('create_untitled_note', {
        parentPath: '/vault/dir',
        vaultPath: '/vault',
      }),
    );
  });

  it('"Nueva nota" del menú de una carpeta también crea sin preguntar', async () => {
    useVaultStore.setState({
      vaultPath: '/vault',
      tree: [{ name: 'dir', path: '/vault/dir', kind: 'folder', children: [] }],
    });
    wrap(<VaultTree />);
    fireEvent.contextMenu(screen.getByTestId('tree-node-dir'));
    fireEvent.click(await screen.findByTestId('context-new-note'));

    await waitFor(() =>
      expect(mockInvoke).toHaveBeenCalledWith('create_untitled_note', {
        parentPath: '/vault/dir',
        vaultPath: '/vault',
      }),
    );
    expect(screen.queryByTestId('name-dialog-overlay')).toBeNull();
  });
});

describe('creación de carpetas con nombre obligatorio', () => {
  it('el botón de nueva carpeta abre el diálogo y crea con el nombre escrito', async () => {
    useVaultStore.setState({ vaultPath: '/vault', tree: [] });
    mockInvoke
      .mockResolvedValueOnce('/vault/proyecto') // create_folder
      .mockResolvedValueOnce(sampleTree); // list_vault_tree

    wrap(<VaultTree />);
    fireEvent.click(screen.getByTestId('new-folder-btn'));

    expect(await screen.findByText('Nueva carpeta', { selector: '[role="dialog"] *' })).toBeInTheDocument();
    const dialog = await screen.findByTestId('name-dialog-input');
    fireEvent.change(dialog, { target: { value: 'proyecto' } });
    fireEvent.click(screen.getByTestId('name-dialog-submit'));

    await waitFor(() =>
      expect(mockInvoke).toHaveBeenCalledWith(
        'create_folder',
        expect.objectContaining({ name: 'proyecto' }),
      ),
    );
  });

  it('no crea nada si el nombre está vacío', async () => {
    useVaultStore.setState({ vaultPath: '/vault', tree: [] });

    wrap(<VaultTree />);
    fireEvent.click(screen.getByTestId('new-folder-btn'));
    fireEvent.click(await screen.findByTestId('name-dialog-submit'));

    expect(await screen.findByTestId('name-dialog-error')).toBeInTheDocument();
    expect(mockInvoke).not.toHaveBeenCalled();
  });

  it('cancelar cierra el diálogo sin crear', async () => {
    useVaultStore.setState({ vaultPath: '/vault', tree: [] });

    wrap(<VaultTree />);
    fireEvent.click(screen.getByTestId('new-folder-btn'));
    fireEvent.click(await screen.findByTestId('name-dialog-cancel'));

    expect(screen.queryByTestId('name-dialog-overlay')).toBeNull();
    expect(mockInvoke).not.toHaveBeenCalled();
  });

  it('si el backend rechaza (already_exists), el diálogo muestra el error y sigue abierto', async () => {
    useVaultStore.setState({ vaultPath: '/vault', tree: [] });
    mockInvoke.mockRejectedValueOnce('already_exists');

    wrap(<VaultTree />);
    fireEvent.click(screen.getByTestId('new-folder-btn'));
    fireEvent.change(await screen.findByTestId('name-dialog-input'), {
      target: { value: 'carpeta' },
    });
    fireEvent.click(screen.getByTestId('name-dialog-submit'));

    expect(await screen.findByTestId('name-dialog-error')).toHaveTextContent(
      'Ya existe una nota o carpeta con ese nombre.',
    );
    expect(screen.getByTestId('name-dialog-overlay')).toBeInTheDocument();
  });
});

describe('drag & drop a la raíz', () => {
  function makeDataTransfer(getDataValue: string) {
    return {
      types: ['application/x-markdaun-entry'],
      setData: vi.fn(),
      getData: vi.fn().mockReturnValue(getDataValue),
      files: [],
      effectAllowed: '',
      dropEffect: '',
    };
  }

  it('soltar una nota en la zona raíz invoca move_entry hacia la raíz del vault', async () => {
    useVaultStore.setState({ vaultPath: '/vault', tree: [] });
    mockInvoke
      .mockResolvedValueOnce('/vault/nota.md') // move_entry
      .mockResolvedValueOnce(sampleTree); // list_vault_tree

    wrap(<VaultTree />);
    fireEvent.drop(screen.getByTestId('vault-tree-scroll'), {
      dataTransfer: makeDataTransfer('/carpeta/nota.md'),
    });

    await waitFor(() =>
      expect(mockInvoke).toHaveBeenCalledWith(
        'move_entry',
        expect.objectContaining({
          sourcePath: '/carpeta/nota.md',
          destFolderPath: '/vault',
        }),
      ),
    );
  });

  it('ignora drops que no traen una entrada del árbol', () => {
    useVaultStore.setState({ vaultPath: '/vault', tree: [] });

    wrap(<VaultTree />);
    fireEvent.drop(screen.getByTestId('vault-tree-scroll'), {
      dataTransfer: { types: ['Files'], getData: vi.fn() },
    });

    expect(mockInvoke).not.toHaveBeenCalled();
  });
});
