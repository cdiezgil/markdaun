import { describe, it, expect } from 'vitest';
import { fuzzyMatch, searchNotes } from './fuzzy';

describe('fuzzyMatch', () => {
  it('returns null when the query is not a subsequence', () => {
    expect(fuzzyMatch('xyz', 'Notas')).toBeNull();
    expect(fuzzyMatch('sa', 'as')).toBeNull();
  });

  it('matches subsequences and reports matched indices', () => {
    const m = fuzzyMatch('nts', 'Notas');
    expect(m?.indices).toEqual([0, 2, 4]);
  });

  it('is case and diacritics insensitive in both directions', () => {
    expect(fuzzyMatch('nota', 'Nóta')?.indices).toEqual([0, 1, 2, 3]);
    expect(fuzzyMatch('NÓTA', 'nota')).not.toBeNull();
    expect(fuzzyMatch('ñu', 'Ñandú')).not.toBeNull();
  });

  it('keeps indices aligned with the original text after normalising', () => {
    expect(fuzzyMatch('c', 'Ñandú café')?.indices).toEqual([6]);
  });

  it('treats an empty query as a trivial match', () => {
    expect(fuzzyMatch('', 'abc')).toEqual({ score: 0, indices: [] });
  });

  it('ignores whitespace in the query', () => {
    expect(fuzzyMatch(' no ta ', 'Nota')).not.toBeNull();
  });

  it('scores a prefix above a mid-word match', () => {
    expect(fuzzyMatch('not', 'Notas')!.score).toBeGreaterThan(fuzzyMatch('not', 'Anotado')!.score);
  });

  it('scores a word-start match above a mid-word match', () => {
    expect(fuzzyMatch('pl', 'mi plan')!.score).toBeGreaterThan(fuzzyMatch('pl', 'simple')!.score);
  });

  it('scores consecutive matches above scattered ones', () => {
    expect(fuzzyMatch('abc', 'xabcx')!.score).toBeGreaterThan(fuzzyMatch('abc', 'axbxcx')!.score);
  });

  it('prefers the best alignment, not the first greedy one', () => {
    // greedy would take the first "a" in "xa-ab"; the best is the consecutive "ab" at the end.
    const m = fuzzyMatch('ab', 'xa ab');
    expect(m?.indices).toEqual([3, 4]);
  });

  it('treats / - _ . and spaces as word separators', () => {
    for (const sep of ['/', '-', '_', '.', ' ']) {
      expect(fuzzyMatch('b', `a${sep}b`)!.score).toBeGreaterThan(fuzzyMatch('b', 'axb')!.score);
    }
  });
});

describe('searchNotes', () => {
  const vault = '/v';
  const note = (rel: string) => ({ name: rel.split('/').pop()!, path: `${vault}/${rel}` });

  it('returns nothing for an empty or blank query', () => {
    expect(searchNotes('', [note('a.md')], vault)).toEqual([]);
    expect(searchNotes('   ', [note('a.md')], vault)).toEqual([]);
  });

  it('matches against the name without the .md extension', () => {
    expect(searchNotes('md', [note('Nota.md')], vault)).toEqual([]);
    const [r] = searchNotes('nota', [note('Nota.md')], vault);
    expect(r.title).toBe('Nota');
    expect(r.titleIndices).toEqual([0, 1, 2, 3]);
  });

  it('matches by path and reports the folder', () => {
    const [r] = searchNotes('proy/idea', [note('Proyectos/idea.md')], vault);
    expect(r.item.path).toBe('/v/Proyectos/idea.md');
    expect(r.dir).toBe('Proyectos');
    expect(r.titleIndices).toEqual([]);
    expect(r.dirIndices.length).toBeGreaterThan(0);
  });

  it('ranks a name match above a path-only match', () => {
    const rs = searchNotes('plan', [note('plan/otra.md'), note('Mi plan.md')], vault);
    expect(rs.map((r) => r.title)).toEqual(['Mi plan', 'otra']);
  });

  it('ranks a prefix above a later match', () => {
    const rs = searchNotes('dia', [note('Mi diario.md'), note('Diario.md')], vault);
    expect(rs[0].title).toBe('Diario');
  });

  it('keeps input order for equal scores (stable)', () => {
    const rs = searchNotes('a', [note('b/a1.md'), note('c/a2.md'), note('d/a3.md')], vault);
    // equal-quality hits keep tree order
    expect(rs.map((r) => r.title)).toEqual(['a1', 'a2', 'a3']);
  });

  it('caps the results at the limit (default 20)', () => {
    const many = Array.from({ length: 30 }, (_, i) => note(`n${i}.md`));
    expect(searchNotes('n', many, vault)).toHaveLength(20);
    expect(searchNotes('n', many, vault, 5)).toHaveLength(5);
  });

  it('works without a vault path using the full path', () => {
    const [r] = searchNotes('idea', [{ name: 'idea.md', path: '/x/idea.md' }], null);
    expect(r.dir).toBe('/x');
  });
});
