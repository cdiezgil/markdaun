import { describe, it, expect } from 'vitest';
import { vaultFolders } from './vaultFolders';

const tree = [
  { name: 'Ideas', path: '/v/Ideas', kind: 'folder' as const, children: [
    { name: 'Deep', path: '/v/Ideas/Deep', kind: 'folder' as const, children: [] },
    { name: 'a.md', path: '/v/Ideas/a.md', kind: 'file' as const },
  ] },
  { name: 'b.md', path: '/v/b.md', kind: 'file' as const },
];

describe('vaultFolders', () => {
  it('lists the root and all nested folders relative to the vault', () => {
    expect(vaultFolders(tree, '/v')).toEqual(['', 'Ideas', 'Ideas/Deep']);
  });
  it('returns just the root for an empty tree', () => {
    expect(vaultFolders([], '/v')).toEqual(['']);
  });
});
