interface TreeEntry {
  name: string;
  path: string;
  kind: 'file' | 'folder';
  children?: TreeEntry[] | null;
}

export interface FolderTreeNode {
  name: string;
  /** Vault-relative path. */
  path: string;
  children: FolderTreeNode[];
}

/** Vault folders as a sorted tree of relative paths; hidden (dot) folders are left out. */
export function buildFolderTree(tree: TreeEntry[], vaultPath: string): FolderTreeNode[] {
  const prefix = vaultPath.replace(/[\\/]+$/, '') + '/';
  const walk = (entries: TreeEntry[]): FolderTreeNode[] =>
    entries
      .filter((e) => e.kind === 'folder' && !e.name.startsWith('.'))
      .map((e) => ({
        name: e.name,
        path: e.path.startsWith(prefix) ? e.path.slice(prefix.length) : e.path,
        children: walk(e.children ?? []),
      }))
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
  return walk(tree);
}

/** Shortens `text` to at most `max` characters, keeping both ends. */
export function middleTruncate(text: string, max: number): string {
  if (text.length <= max) return text;
  const keep = max - 1;
  const head = Math.ceil(keep / 2);
  const tail = keep - head;
  return `${text.slice(0, head)}…${text.slice(text.length - tail)}`;
}
