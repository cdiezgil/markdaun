import { describe, it, expect } from 'vitest';
import { viewForPath } from './shell';
import { countVaultEntries, formatVaultCounts } from './vaultCounts';
import { graphStats, formatGraphStats } from './graphStats';
import type { VaultEntry } from '../store/vaultStore';

describe('viewForPath', () => {
  it('maps routes to shell views', () => {
    expect(viewForPath('/')).toBe('notes');
    expect(viewForPath('/editor/%2Fv%2Fa.md')).toBe('notes');
    expect(viewForPath('/preview/x')).toBe('notes');
    expect(viewForPath('/graph')).toBe('graph');
    expect(viewForPath('/brain')).toBe('brain');
    expect(viewForPath('/settings')).toBe('settings');
  });
});

const file = (name: string, file_type: VaultEntry['file_type'] = 'md'): VaultEntry => ({
  name,
  path: `/v/${name}`,
  kind: 'file',
  file_type,
});

describe('countVaultEntries / formatVaultCounts', () => {
  it('counts md notes and folders recursively, ignoring other files', () => {
    const tree: VaultEntry[] = [
      { name: 'Test', path: '/v/Test', kind: 'folder', children: [file('a.md'), file('b.png', 'image')] },
      file('c.md'),
      { name: 'Empty', path: '/v/Empty', kind: 'folder' },
    ];
    expect(countVaultEntries(tree)).toEqual({ notes: 2, folders: 2 });
  });

  it('formats with Spanish plurals', () => {
    expect(formatVaultCounts({ notes: 3, folders: 1 })).toBe('3 notas · 1 carpeta');
    expect(formatVaultCounts({ notes: 1, folders: 0 })).toBe('1 nota · 0 carpetas');
  });
});

describe('graphStats / formatGraphStats', () => {
  const nodes = [
    { id: 'orphanGroup_root', type: 'orphanGroup', position: { x: 0, y: 0 }, data: { folderName: 'root' } },
    { id: 'a', position: { x: 0, y: 0 }, data: { kind: 'md', isOrphan: false } },
    { id: 'b', position: { x: 0, y: 0 }, data: { kind: 'md', isOrphan: false } },
    { id: 'c', position: { x: 0, y: 0 }, data: { kind: 'md', isOrphan: true } },
    { id: 'img', position: { x: 0, y: 0 }, data: { kind: 'image', isOrphan: true } },
  ];
  const edges = [{ id: 'a→b', source: 'a', target: 'b' }];

  it('counts md notes, edges and orphan notes only', () => {
    expect(graphStats(nodes, edges)).toEqual({ notes: 3, links: 1, orphans: 1 });
  });

  it('formats the status line', () => {
    expect(formatGraphStats({ notes: 3, links: 1, orphans: 1 })).toBe('3 notas · 1 enlace · 1 huérfana');
    expect(formatGraphStats({ notes: 1, links: 2, orphans: 0 })).toBe('1 nota · 2 enlaces · 0 huérfanas');
  });
});
