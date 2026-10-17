import { describe, it, expect, vi, beforeEach } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import { useVaultStore } from './vaultStore';
import type { VaultEntry } from './vaultStore';

const mockInvoke = vi.mocked(invoke);

const sampleTree: VaultEntry[] = [
  { name: 'nota.md', path: '/vault/nota.md', kind: 'file', file_type: 'md' },
];

beforeEach(() => {
  vi.clearAllMocks();
  useVaultStore.setState({
    vaultPath: null,
    tree: [],
    isLoading: false,
    error: null,
  });
});

describe('TC-01: openVault con path', () => {
  it('TC-01: persiste vaultPath y carga árbol cuando el usuario selecciona carpeta', async () => {
    mockInvoke
      .mockResolvedValueOnce('/vault') // open_vault_dialog
      .mockResolvedValueOnce(sampleTree); // list_vault_tree

    await useVaultStore.getState().openVault();

    expect(useVaultStore.getState().vaultPath).toBe('/vault');
    expect(useVaultStore.getState().tree).toEqual(sampleTree);
    expect(useVaultStore.getState().error).toBeNull();
  });
});

describe('TC-02: openVault cancelado', () => {
  it('TC-02: no cambia vaultPath cuando el diálogo se cancela', async () => {
    mockInvoke.mockResolvedValueOnce(null); // open_vault_dialog returns null

    await useVaultStore.getState().openVault();

    expect(useVaultStore.getState().vaultPath).toBeNull();
    expect(useVaultStore.getState().tree).toEqual([]);
  });
});

describe('TC-03: loadVault sin bóveda', () => {
  it('TC-03: no carga árbol cuando no hay bóveda activa', async () => {
    mockInvoke.mockResolvedValueOnce(null); // get_active_vault returns null

    await useVaultStore.getState().loadVault();

    expect(useVaultStore.getState().vaultPath).toBeNull();
    expect(useVaultStore.getState().tree).toEqual([]);
  });
});

describe('TC-03: loadVault con bóveda', () => {
  it('TC-03: recupera ruta y carga árbol al relanzar app', async () => {
    mockInvoke
      .mockResolvedValueOnce('/vault') // get_active_vault
      .mockResolvedValueOnce(sampleTree); // list_vault_tree

    await useVaultStore.getState().loadVault();

    expect(useVaultStore.getState().vaultPath).toBe('/vault');
    expect(useVaultStore.getState().tree).toEqual(sampleTree);
  });
});

describe('refreshTree', () => {
  it('refresca el árbol usando la vaultPath actual', async () => {
    useVaultStore.setState({ vaultPath: '/vault' });
    mockInvoke.mockResolvedValueOnce(sampleTree);

    await useVaultStore.getState().refreshTree();

    expect(useVaultStore.getState().tree).toEqual(sampleTree);
    expect(mockInvoke).toHaveBeenCalledWith('list_vault_tree', {
      vaultPath: '/vault',
    });
  });

  it('no llama a invoke si no hay vaultPath', async () => {
    await useVaultStore.getState().refreshTree();
    expect(mockInvoke).not.toHaveBeenCalled();
  });
});

describe('TC-09: createNote happy path', () => {
  it('TC-09: crea nota y refresca árbol', async () => {
    useVaultStore.setState({ vaultPath: '/vault' });
    mockInvoke
      .mockResolvedValueOnce('/vault/nueva.md') // create_note
      .mockResolvedValueOnce(sampleTree); // list_vault_tree

    await useVaultStore.getState().createNote('/vault', 'nueva');

    expect(mockInvoke).toHaveBeenCalledWith('create_note', {
      parentPath: '/vault',
      name: 'nueva',
      vaultPath: '/vault',
    });
    expect(useVaultStore.getState().tree).toEqual(sampleTree);
  });
});

describe('TC-22: createNote ya existe', () => {
  it('TC-22: propaga error already_exists', async () => {
    useVaultStore.setState({ vaultPath: '/vault' });
    mockInvoke.mockRejectedValueOnce('already_exists');

    await expect(
      useVaultStore.getState().createNote('/vault', 'nueva.md'),
    ).rejects.toMatch('already_exists');
    expect(useVaultStore.getState().error).toBe('already_exists');
  });
});

describe('TC-10: createFolder happy path', () => {
  it('TC-10: crea carpeta y refresca árbol', async () => {
    useVaultStore.setState({ vaultPath: '/vault' });
    mockInvoke
      .mockResolvedValueOnce('/vault/carpeta') // create_folder
      .mockResolvedValueOnce(sampleTree); // list_vault_tree

    await useVaultStore.getState().createFolder('/vault', 'carpeta');

    expect(mockInvoke).toHaveBeenCalledWith('create_folder', {
      parentPath: '/vault',
      name: 'carpeta',
      vaultPath: '/vault',
    });
  });
});

describe('TC-11: renameEntry happy path', () => {
  it('TC-11: renombra entrada y refresca árbol', async () => {
    useVaultStore.setState({ vaultPath: '/vault' });
    mockInvoke
      .mockResolvedValueOnce('/vault/renombrado.md') // rename_entry
      .mockResolvedValueOnce(sampleTree); // list_vault_tree

    await useVaultStore.getState().renameEntry('/vault/nota.md', 'renombrado.md');

    expect(mockInvoke).toHaveBeenCalledWith('rename_entry', {
      path: '/vault/nota.md',
      newName: 'renombrado.md',
      vaultPath: '/vault',
    });
  });
});

describe('TC-12: renameEntry carpeta', () => {
  it('TC-12: renombra carpeta y refresca árbol', async () => {
    useVaultStore.setState({ vaultPath: '/vault' });
    mockInvoke
      .mockResolvedValueOnce('/vault/nueva-carpeta') // rename_entry
      .mockResolvedValueOnce(sampleTree); // list_vault_tree

    await useVaultStore.getState().renameEntry('/vault/carpeta', 'nueva-carpeta');

    expect(useVaultStore.getState().tree).toEqual(sampleTree);
  });
});

describe('TC-16: importFileData happy path', () => {
  it('TC-16: importa el contenido de un fichero soltado y refresca el árbol', async () => {
    useVaultStore.setState({ vaultPath: '/vault' });
    mockInvoke
      .mockResolvedValueOnce('/vault/foto.png') // import_file_data
      .mockResolvedValueOnce(sampleTree); // list_vault_tree

    await useVaultStore.getState().importFileData('/vault', 'foto.png', new Uint8Array([1, 2, 3]));

    expect(mockInvoke).toHaveBeenCalledWith('import_file_data', {
      destFolderPath: '/vault',
      fileName: 'foto.png',
      contents: [1, 2, 3],
      vaultPath: '/vault',
    });
    expect(useVaultStore.getState().tree).toEqual(sampleTree);
  });
});

describe('TC-19: openVault reemplaza bóveda activa', () => {
  it('TC-19: /B reemplaza /A como bóveda activa', async () => {
    useVaultStore.setState({ vaultPath: '/A' });
    mockInvoke
      .mockResolvedValueOnce('/B') // open_vault_dialog
      .mockResolvedValueOnce(sampleTree); // list_vault_tree

    await useVaultStore.getState().openVault();

    expect(useVaultStore.getState().vaultPath).toBe('/B');
  });
});

describe('moveEntry', () => {
  it('invoca move_entry con sourcePath, destFolderPath y vaultPath, y refresca', async () => {
    useVaultStore.setState({ vaultPath: '/vault' });
    mockInvoke
      .mockResolvedValueOnce('/vault/carpeta/nota.md') // move_entry
      .mockResolvedValueOnce(sampleTree); // list_vault_tree

    await useVaultStore.getState().moveEntry('/vault/nota.md', '/vault/carpeta');

    expect(mockInvoke).toHaveBeenCalledWith('move_entry', {
      sourcePath: '/vault/nota.md',
      destFolderPath: '/vault/carpeta',
      vaultPath: '/vault',
    });
    expect(useVaultStore.getState().tree).toEqual(sampleTree);
  });

  it('propaga el error del backend y no refresca', async () => {
    useVaultStore.setState({ vaultPath: '/vault' });
    mockInvoke.mockRejectedValueOnce('already_exists');

    await expect(
      useVaultStore.getState().moveEntry('/vault/a.md', '/vault/carpeta'),
    ).rejects.toBe('already_exists');
    expect(useVaultStore.getState().error).toBe('already_exists');
  });
});
