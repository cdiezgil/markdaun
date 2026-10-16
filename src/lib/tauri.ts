import { invoke, convertFileSrc } from '@tauri-apps/api/core';

export { invoke, convertFileSrc } from '@tauri-apps/api/core';
export { getCurrentWindow } from '@tauri-apps/api/window';

// ── Types ──────────────────────────────────────────────────────────────────────

export interface VaultEntry {
  name: string;
  path: string;
  kind: 'file' | 'folder';
  file_type: 'md' | 'image' | 'pdf' | 'other' | null;
  children: VaultEntry[] | null;
}

// ── Typed Tauri command wrappers ───────────────────────────────────────────────

/** Read the UTF-8 content of a note within the vault. */
export async function readNote(path: string, vaultPath: string): Promise<string> {
  return invoke<string>('read_note', { path, vaultPath });
}

/** Write content to a note within the vault (creates or overwrites). */
export async function writeNote(
  path: string,
  content: string,
  vaultPath: string,
): Promise<void> {
  return invoke<void>('write_note', { path, content, vaultPath });
}

/** Open the native file picker filtered to image types.
 *  Returns the absolute path selected, or null if cancelled. */
export async function pickImageFile(): Promise<string | null> {
  return invoke<string | null>('pick_image_file');
}

/** Return the currently configured vault path, or null if none. */
export async function getActiveVault(): Promise<string | null> {
  return invoke<string | null>('get_active_vault');
}

/** List the vault directory tree recursively. */
export async function listVaultTree(vaultPath: string): Promise<VaultEntry[]> {
  return invoke<VaultEntry[]>('list_vault_tree', { vaultPath });
}

/** Convert an absolute local path to a Tauri asset URL suitable for <img src>. */
export function convertAssetSrc(absolutePath: string): string {
  return convertFileSrc(absolutePath);
}
