import type { VaultEntry } from '../store/vaultStore';
import { plural } from './shell';

export interface VaultCounts {
  notes: number;
  folders: number;
}

export function countVaultEntries(tree: VaultEntry[]): VaultCounts {
  const counts: VaultCounts = { notes: 0, folders: 0 };
  const visit = (entries: VaultEntry[]) => {
    for (const e of entries) {
      if (e.kind === 'folder') {
        counts.folders += 1;
        if (e.children) visit(e.children);
      } else if (e.file_type === 'md') {
        counts.notes += 1;
      }
    }
  };
  visit(tree);
  return counts;
}

export function formatVaultCounts({ notes, folders }: VaultCounts): string {
  return `${notes} ${plural(notes, 'nota', 'notas')} · ${folders} ${plural(folders, 'carpeta', 'carpetas')}`;
}
