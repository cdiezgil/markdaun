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
