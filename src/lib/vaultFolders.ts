interface FolderNode {
  path: string;
  kind: 'file' | 'folder';
  children?: FolderNode[] | null;
}

/** Vault-relative folder paths, root ('') first, depth-first. */
export function vaultFolders(tree: FolderNode[], vaultPath: string): string[] {
  const prefix = vaultPath.replace(/[\\/]+$/, '') + '/';
  const out: string[] = [''];
  const walk = (nodes: FolderNode[]) => {
    for (const n of nodes) {
      if (n.kind !== 'folder') continue;
      out.push(n.path.startsWith(prefix) ? n.path.slice(prefix.length) : n.path);
      if (n.children) walk(n.children);
    }
  };
  walk(tree);
  return out;
}
