import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mocks are defined in src/test/setup.ts (vi.mock('@tauri-apps/api/core'))
import { invoke } from '@tauri-apps/api/core';
import {
  readNote,
  writeNote,
  pickImageFile,
  getActiveVault,
  listVaultTree,
  convertAssetSrc,
  githubConnectPreview,
githubConnectApply,
  githubGetConfig,
  githubDisconnect,
  githubPush,
  githubPull,
  githubStatus,
  ideOpenFolderDialog,
  ideListTree,
  ideReadFile,
  ideWriteFile,
  ideCreateFile,
  ideCreateFolder,
  ideRenameEntry,
  ideDeleteEntry,
  ideGetProjects,
  ideSaveProjects,
} from './tauri';

const mockInvoke = vi.mocked(invoke);

beforeEach(() => {
  vi.clearAllMocks();
});

// ── TC-22: readNote happy path ─────────────────────────────────────────────────
describe('TC-22: readNote', () => {
  it('TC-22: invokes read_note with correct params and returns content', async () => {
    mockInvoke.mockResolvedValueOnce('# Hola\n\nContenido');
    const result = await readNote('/vault/note.md', '/vault');
    expect(mockInvoke).toHaveBeenCalledWith('read_note', {
      path: '/vault/note.md',
      vaultPath: '/vault',
    });
    expect(result).toBe('# Hola\n\nContenido');
  });

  it('TC-22: propagates path_not_found error from backend', async () => {
    mockInvoke.mockRejectedValueOnce('path_not_found');
    await expect(readNote('/vault/missing.md', '/vault')).rejects.toBe('path_not_found');
  });

  it('TC-23: propagates path_outside_vault error from backend', async () => {
    mockInvoke.mockRejectedValueOnce('path_outside_vault');
    await expect(readNote('/tmp/evil.md', '/vault')).rejects.toBe('path_outside_vault');
  });
});

// ── TC-24: writeNote happy path ───────────────────────────────────────────────
describe('TC-24: writeNote', () => {
  it('TC-24: invokes write_note with correct params', async () => {
    mockInvoke.mockResolvedValueOnce(undefined);
    await writeNote('/vault/note.md', 'hola', '/vault');
    expect(mockInvoke).toHaveBeenCalledWith('write_note', {
      path: '/vault/note.md',
      content: 'hola',
      vaultPath: '/vault',
    });
  });

  it('TC-24: propagates path_outside_vault on write outside vault', async () => {
    mockInvoke.mockRejectedValueOnce('path_outside_vault');
    await expect(writeNote('/tmp/evil.md', 'x', '/vault')).rejects.toBe('path_outside_vault');
  });

  it('TC-24: propagates io_error on permission denied', async () => {
    mockInvoke.mockRejectedValueOnce('io_error: permission denied');
    await expect(writeNote('/vault/note.md', 'x', '/vault')).rejects.toBe(
      'io_error: permission denied',
    );
  });
});

// ── TC-25 / TC-26: pickImageFile ──────────────────────────────────────────────
describe('TC-25 / TC-26: pickImageFile', () => {
  it('TC-25: returns null when user cancels', async () => {
    mockInvoke.mockResolvedValueOnce(null);
    const result = await pickImageFile();
    expect(mockInvoke).toHaveBeenCalledWith('pick_image_file');
    expect(result).toBeNull();
  });

  it('TC-26: returns selected path', async () => {
    mockInvoke.mockResolvedValueOnce('/vault/img.png');
    const result = await pickImageFile();
    expect(result).toBe('/vault/img.png');
  });
});

// ── getActiveVault ─────────────────────────────────────────────────────────────
describe('getActiveVault', () => {
  it('invokes get_active_vault and returns vault path', async () => {
    mockInvoke.mockResolvedValueOnce('/home/user/vault');
    const result = await getActiveVault();
    expect(mockInvoke).toHaveBeenCalledWith('get_active_vault');
    expect(result).toBe('/home/user/vault');
  });

  it('returns null when no vault configured', async () => {
    mockInvoke.mockResolvedValueOnce(null);
    const result = await getActiveVault();
    expect(result).toBeNull();
  });
});

// ── listVaultTree ─────────────────────────────────────────────────────────────
describe('listVaultTree', () => {
  it('invokes list_vault_tree with correct params and returns entries', async () => {
    const entries = [
      { name: 'note.md', path: '/vault/note.md', kind: 'file', file_type: 'md', children: null },
    ];
    mockInvoke.mockResolvedValueOnce(entries);
    const result = await listVaultTree('/vault');
    expect(mockInvoke).toHaveBeenCalledWith('list_vault_tree', { vaultPath: '/vault' });
    expect(result).toEqual(entries);
  });
});

// ── convertAssetSrc ───────────────────────────────────────────────────────────
describe('convertAssetSrc', () => {
  it('converts an absolute path to a tauri asset URL', () => {
    const url = convertAssetSrc('/vault/img.png');
    expect(url).toContain('/vault/img.png');
  });
});

// ── GitHub Sync wrappers ──────────────────────────────────────────────────────

describe('githubConnectPreview', () => {
  it('TC-GH-01: invokes github_connect_preview with camelCase args and returns the preview', async () => {
    const preview = { case: 'local_empty', remoteCount: 1000, localCount: 0 };
    mockInvoke.mockResolvedValueOnce(preview);
    const result = await githubConnectPreview('https://github.com/u/r', 'token123', '/vault');
    expect(mockInvoke).toHaveBeenCalledWith('github_connect_preview', {
      repoUrl: 'https://github.com/u/r',
      pat: 'token123',
      vaultPath: '/vault',
    });
    expect(result).toEqual(preview);
  });
});

describe('githubConnectApply', () => {
  it('TC-GH-02: invokes github_connect_apply with the user choice', async () => {
    mockInvoke.mockResolvedValueOnce({ action: 'cloned', conflicts: [] });
    const result = await githubConnectApply('https://github.com/u/r', 'token123', '/vault', 'download');
    expect(mockInvoke).toHaveBeenCalledWith('github_connect_apply', {
      repoUrl: 'https://github.com/u/r',
      pat: 'token123',
      vaultPath: '/vault',
      choice: 'download',
    });
    expect(result.action).toBe('cloned');
  });
});

describe('githubGetConfig', () => {
  it('TC-GH-03: invokes github_get_config and returns the repo URL', async () => {
    mockInvoke.mockResolvedValueOnce('https://github.com/u/r');
    const result = await githubGetConfig();
    expect(mockInvoke).toHaveBeenCalledWith('github_get_config');
    expect(result).toBe('https://github.com/u/r');
  });

  it('TC-GH-04: returns null when not configured', async () => {
    mockInvoke.mockResolvedValueOnce(null);
    const result = await githubGetConfig();
    expect(result).toBeNull();
  });
});

describe('githubDisconnect', () => {
  it('TC-GH-05: invokes github_disconnect', async () => {
    mockInvoke.mockResolvedValueOnce(undefined);
    await githubDisconnect();
    expect(mockInvoke).toHaveBeenCalledWith('github_disconnect');
  });
});

describe('githubPush', () => {
  it('TC-GH-06: invokes github_push without confirmation by default', async () => {
    mockInvoke.mockResolvedValueOnce({ conflicts: [], needsConfirmation: null });
    const result = await githubPush();
    expect(mockInvoke).toHaveBeenCalledWith('github_push', { confirmDeletions: false });
    expect(result.needsConfirmation).toBeNull();
  });

  it('TC-GH-06b: passes confirmDeletions when the user confirmed', async () => {
    mockInvoke.mockResolvedValueOnce({ conflicts: [], needsConfirmation: null });
    await githubPush(true);
    expect(mockInvoke).toHaveBeenCalledWith('github_push', { confirmDeletions: true });
  });

  it('TC-GH-07: propagates errors from the backend', async () => {
    mockInvoke.mockRejectedValueOnce('not_configured');
    await expect(githubPush()).rejects.toBe('not_configured');
  });
});

describe('githubPull', () => {
  it('TC-GH-08: invokes github_pull and returns the conflicts', async () => {
    mockInvoke.mockResolvedValueOnce({ conflicts: ['a (conflicto x).md'], needsConfirmation: null });
    const r = await githubPull();
    expect(r.conflicts).toEqual(['a (conflicto x).md']);
    expect(mockInvoke).toHaveBeenCalledWith('github_pull');
  });

  it('TC-GH-09: propagates errors from the backend', async () => {
    mockInvoke.mockRejectedValueOnce('git_error: network failure');
    await expect(githubPull()).rejects.toBe('git_error: network failure');
  });
});

describe('githubStatus', () => {
  it('TC-GH-10: invokes github_status and returns true when changes exist', async () => {
    mockInvoke.mockResolvedValueOnce(true);
    const result = await githubStatus();
    expect(mockInvoke).toHaveBeenCalledWith('github_status');
    expect(result).toBe(true);
  });

  it('TC-GH-11: returns false when vault is clean', async () => {
    mockInvoke.mockResolvedValueOnce(false);
    const result = await githubStatus();
    expect(result).toBe(false);
  });
});

// ── IDE Tauri bindings ────────────────────────────────────────────────────────────

describe('TC-01/TC-15: ideOpenFolderDialog', () => {
  it('TC-01: returns chosen folder path', async () => {
    mockInvoke.mockResolvedValueOnce('/tmp/my-project');
    const result = await ideOpenFolderDialog();
    expect(mockInvoke).toHaveBeenCalledWith('ide_open_folder_dialog');
    expect(result).toBe('/tmp/my-project');
  });

  it('TC-01: returns null when user cancels', async () => {
    mockInvoke.mockResolvedValueOnce(null);
    const result = await ideOpenFolderDialog();
    expect(result).toBeNull();
  });
});

describe('TC-14: ideListTree', () => {
  it('TC-14: invokes ide_list_tree with rootPath and returns entries', async () => {
    const entries = [
      { name: 'README.md', path: '/tmp/p/README.md', kind: 'file', file_type: 'md', children: null },
    ];
    mockInvoke.mockResolvedValueOnce(entries);
    const result = await ideListTree('/tmp/p');
    expect(mockInvoke).toHaveBeenCalledWith('ide_list_tree', { rootPath: '/tmp/p' });
    expect(result).toEqual(entries);
  });

  it('TC-14: rejects with path_not_found when dir does not exist', async () => {
    mockInvoke.mockRejectedValueOnce('path_not_found');
    await expect(ideListTree('/nonexistent')).rejects.toBe('path_not_found');
  });
});

describe('TC-05/TC-07: ideReadFile', () => {
  it('TC-05: reads file content', async () => {
    mockInvoke.mockResolvedValueOnce('# Hola\n');
    const result = await ideReadFile('/tmp/p/README.md');
    expect(mockInvoke).toHaveBeenCalledWith('ide_read_file', { path: '/tmp/p/README.md' });
    expect(result).toBe('# Hola\n');
  });

  it('TC-05: rejects with path_not_found', async () => {
    mockInvoke.mockRejectedValueOnce('path_not_found');
    await expect(ideReadFile('/tmp/missing.md')).rejects.toBe('path_not_found');
  });
});

describe('TC-07: ideWriteFile', () => {
  it('TC-07: writes file content', async () => {
    mockInvoke.mockResolvedValueOnce(undefined);
    await ideWriteFile('/tmp/p/README.md', '# Updated\n');
    expect(mockInvoke).toHaveBeenCalledWith('ide_write_file', {
      path: '/tmp/p/README.md',
      content: '# Updated\n',
    });
  });

  it('TC-07: rejects with path_not_found when parent dir missing', async () => {
    mockInvoke.mockRejectedValueOnce('path_not_found');
    await expect(ideWriteFile('/tmp/nodir/f.md', 'x')).rejects.toBe('path_not_found');
  });
});

describe('TC-08/TC-13: ideCreateFile', () => {
  it('TC-08: creates a file and returns the path', async () => {
    mockInvoke.mockResolvedValueOnce('/tmp/p/nueva.md');
    const result = await ideCreateFile('/tmp/p', 'nueva.md');
    expect(mockInvoke).toHaveBeenCalledWith('ide_create_file', { parentPath: '/tmp/p', name: 'nueva.md' });
    expect(result).toBe('/tmp/p/nueva.md');
  });

  it('TC-13: rejects with invalid_name for path traversal', async () => {
    mockInvoke.mockRejectedValueOnce('invalid_name');
    await expect(ideCreateFile('/tmp/p', '../../etc/passwd')).rejects.toBe('invalid_name');
  });

  it('TC-08: rejects with already_exists when file exists', async () => {
    mockInvoke.mockRejectedValueOnce('already_exists');
    await expect(ideCreateFile('/tmp/p', 'existing.md')).rejects.toBe('already_exists');
  });
});

describe('TC-11: ideCreateFolder', () => {
  it('TC-11: creates a folder and returns the path', async () => {
    mockInvoke.mockResolvedValueOnce('/tmp/p/src');
    const result = await ideCreateFolder('/tmp/p', 'src');
    expect(mockInvoke).toHaveBeenCalledWith('ide_create_folder', { parentPath: '/tmp/p', name: 'src' });
    expect(result).toBe('/tmp/p/src');
  });

  it('TC-11: rejects with already_exists when folder exists', async () => {
    mockInvoke.mockRejectedValueOnce('already_exists');
    await expect(ideCreateFolder('/tmp/p', 'existing')).rejects.toBe('already_exists');
  });
});

describe('TC-09/TC-16: ideRenameEntry', () => {
  it('TC-09: renames and returns new path', async () => {
    mockInvoke.mockResolvedValueOnce('/tmp/p/apuntes.md');
    const result = await ideRenameEntry('/tmp/p/notes.md', 'apuntes.md');
    expect(mockInvoke).toHaveBeenCalledWith('ide_rename_entry', {
      path: '/tmp/p/notes.md',
      newName: 'apuntes.md',
    });
    expect(result).toBe('/tmp/p/apuntes.md');
  });

  it('TC-16: rejects with invalid_name for slash in name', async () => {
    mockInvoke.mockRejectedValueOnce('invalid_name');
    await expect(ideRenameEntry('/tmp/p/f.md', 'fo/bar')).rejects.toBe('invalid_name');
  });
});

describe('TC-10: ideDeleteEntry', () => {
  it('TC-10: deletes a file', async () => {
    mockInvoke.mockResolvedValueOnce(undefined);
    await ideDeleteEntry('/tmp/p/old.md');
    expect(mockInvoke).toHaveBeenCalledWith('ide_delete_entry', { path: '/tmp/p/old.md' });
  });
});

describe('TC-02: ideGetProjects / ideSaveProjects', () => {
  it('TC-02: returns empty array when no projects saved', async () => {
    mockInvoke.mockResolvedValueOnce([]);
    const result = await ideGetProjects();
    expect(mockInvoke).toHaveBeenCalledWith('ide_get_projects');
    expect(result).toEqual([]);
  });

  it('TC-02: returns saved projects', async () => {
    mockInvoke.mockResolvedValueOnce(['/tmp/p1', '/tmp/p2']);
    const result = await ideGetProjects();
    expect(result).toEqual(['/tmp/p1', '/tmp/p2']);
  });

  it('TC-02: ideSaveProjects persists the list', async () => {
    mockInvoke.mockResolvedValueOnce(undefined);
    await ideSaveProjects(['/tmp/p1', '/tmp/p2']);
    expect(mockInvoke).toHaveBeenCalledWith('ide_save_projects', {
      projects: ['/tmp/p1', '/tmp/p2'],
    });
  });
});
