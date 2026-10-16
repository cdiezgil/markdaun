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
  githubConfigure,
  githubGetConfig,
  githubDisconnect,
  githubPush,
  githubPull,
  githubStatus,
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

describe('githubConfigure', () => {
  it('TC-GH-01: invokes github_configure with correct params and returns "pushed"', async () => {
    mockInvoke.mockResolvedValueOnce('pushed');
    const result = await githubConfigure('https://github.com/u/r', 'token123', '/vault');
    expect(mockInvoke).toHaveBeenCalledWith('github_configure', {
      repoUrl: 'https://github.com/u/r',
      pat: 'token123',
      vaultPath: '/vault',
    });
    expect(result).toBe('pushed');
  });

  it('TC-GH-02: returns "cloned" when the vault is empty and remote is cloned', async () => {
    mockInvoke.mockResolvedValueOnce('cloned');
    const result = await githubConfigure('https://github.com/u/r', 'token123', '/vault');
    expect(result).toBe('cloned');
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
  it('TC-GH-06: invokes github_push', async () => {
    mockInvoke.mockResolvedValueOnce(undefined);
    await githubPush();
    expect(mockInvoke).toHaveBeenCalledWith('github_push');
  });

  it('TC-GH-07: propagates errors from the backend', async () => {
    mockInvoke.mockRejectedValueOnce('not_configured');
    await expect(githubPush()).rejects.toBe('not_configured');
  });
});

describe('githubPull', () => {
  it('TC-GH-08: invokes github_pull', async () => {
    mockInvoke.mockResolvedValueOnce(undefined);
    await githubPull();
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
