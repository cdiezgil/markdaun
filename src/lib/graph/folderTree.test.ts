import { describe, it, expect } from 'vitest';
import { buildFolderTree, middleTruncate } from './folderTree';

const f = (name: string, path: string, children: unknown[] = []) => ({
  name,
  path,
  kind: 'folder' as const,
  children: children as never[],
});
const file = (name: string, path: string) => ({ name, path, kind: 'file' as const });

describe('buildFolderTree', () => {
  it('lists only folders, relative paths, sorted by name', () => {
    const tree = [
      file('x.md', '/v/x.md'),
      f('zeta', '/v/zeta'),
      f('Mutua', '/v/Mutua', [f('ProyectoX', '/v/Mutua/ProyectoX'), file('a.md', '/v/Mutua/a.md')]),
      f('alpha', '/v/alpha'),
    ];
    const out = buildFolderTree(tree, '/v');
    expect(out.map((n) => n.name)).toEqual(['alpha', 'Mutua', 'zeta']);
    expect(out[1].children[0]).toMatchObject({ name: 'ProyectoX', path: 'Mutua/ProyectoX', children: [] });
  });
  it('excludes hidden folders', () => {
    const tree = [f('.markdaun', '/v/.markdaun'), f('Entrada', '/v/Entrada', [f('.x', '/v/Entrada/.x')])];
    const out = buildFolderTree(tree, '/v');
    expect(out.map((n) => n.name)).toEqual(['Entrada']);
    expect(out[0].children).toEqual([]);
  });
});

describe('middleTruncate', () => {
  it('keeps short text', () => expect(middleTruncate('Mutua/X', 24)).toBe('Mutua/X'));
  it('truncates the middle of long text', () => {
    const t = middleTruncate('Mutua/Proyectos/Largo/Muy/Profundo/Final', 20);
    expect(t.length).toBeLessThanOrEqual(20);
    expect(t).toContain('…');
    expect(t.startsWith('Mutua')).toBe(true);
    expect(t.endsWith('Final')).toBe(true);
  });
});
