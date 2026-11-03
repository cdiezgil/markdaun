import { describe, expect, it } from 'vitest';
import { buildIndex } from './search';

const notes = [
  { path: 'Cocina/Tarta.md', text: '# Tarta de Limón\n\nUsa mucho limón rallado y azúcar.' },
  { path: 'Diario/hoy.md', text: 'Sin título, solo pan.' },
];

describe('search', () => {
  it('ignores accents and case', () => {
    const r = buildIndex(notes).search('limon');
    expect(r.map((x) => x.path)).toEqual(['Cocina/Tarta.md']);
    expect(r[0]).toMatchObject({ title: 'Tarta de Limón', folder: 'Cocina' });
  });
  it('title falls back to file stem', () => {
    expect(buildIndex(notes).search('pan')[0].title).toBe('hoy');
  });
  it('snippet highlights the match (escaped)', () => {
    const idx = buildIndex([{ path: 'a.md', text: 'x <b> rallado de LIMÓN fresco' }]);
    const s = idx.search('limon')[0].snippet;
    expect(s).toContain('<mark>LIMÓN</mark>');
    expect(s).toContain('&lt;b&gt;');
  });
  it('supports prefix and fuzzy', () => {
    expect(buildIndex(notes).search('rall')).toHaveLength(1);
    expect(buildIndex(notes).search('azucsr')).toHaveLength(1);
  });
  it('update adds, replaces and removes', () => {
    const idx = buildIndex(notes);
    idx.update([{ path: 'Diario/hoy.md', text: 'ahora gazpacho' }, { path: 'n.md', text: 'nuevo' }], ['Cocina/Tarta.md']);
    expect(idx.search('limon')).toHaveLength(0);
    expect(idx.search('pan')).toHaveLength(0);
    expect(idx.search('gazpacho')).toHaveLength(1);
    expect(idx.search('nuevo')).toHaveLength(1);
    idx.update([], ['ghost.md']);
  });
  it('empty query returns nothing', () => {
    expect(buildIndex(notes).search('  ')).toEqual([]);
  });
});
