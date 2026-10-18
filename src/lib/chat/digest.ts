import type { DigestProgress } from '../tauri';
import type { ProposalState } from '../../store/noteProposalStore';

/** Folder part of a vault-relative note path ('' = vault root). */
export function folderOf(path: string): string {
  const p = path.trim();
  const i = p.lastIndexOf('/');
  return i < 0 ? '' : p.slice(0, i);
}

/** The proposal would create a folder that does not exist yet. */
export function isNewFolder(path: string, folders: string[]): boolean {
  const folder = folderOf(path);
  return folder !== '' && !folders.includes(folder);
}

/**
 * Folder (vault-relative) of the first accepted card among the given
 * messages' proposals; null while nothing was accepted. The first accepted
 * note decides where the source is archived.
 */
export function firstAcceptedFolder(
  states: Record<string, ProposalState>,
  messageIds: string[],
  vaultPath: string,
): string | null {
  const ids = new Set(messageIds);
  const root = vaultPath.replace(/[\\/]+$/, '');
  let best: { seq: number; abs: string } | null = null;
  for (const [key, st] of Object.entries(states)) {
    if (!ids.has(key.slice(0, key.lastIndexOf(':')))) continue;
    if ((st.status !== 'created' && st.status !== 'appended') || !st.absolutePath) continue;
    const seq = st.seq ?? Number.MAX_SAFE_INTEGER;
    if (!best || seq < best.seq) best = { seq, abs: st.absolutePath };
  }
  if (!best) return null;
  const abs = best.abs.replace(/\\/g, '/');
  const rel = abs.startsWith(root + '/') ? abs.slice(root.length + 1) : abs;
  return folderOf(rel);
}

export function digestProgressLabel(p: DigestProgress | null): string | null {
  if (!p) return null;
  return p.consolidating ? 'Consolidando notas…' : `Parte ${p.part}/${p.total}`;
}
