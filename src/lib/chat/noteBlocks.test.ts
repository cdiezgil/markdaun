import { describe, it, expect } from 'vitest';
import { parseNoteBlocks } from './noteBlocks';

const block = (attrs: string, body = '# T\nbody') => '```markdaun-note ' + attrs + '\n' + body + '\n```';

describe('parseNoteBlocks', () => {
  it('returns one text segment when there are no blocks', () => {
    expect(parseNoteBlocks('hello')).toEqual([{ type: 'text', text: 'hello' }]);
  });

  it('parses a create block and keeps surrounding text', () => {
    const segs = parseNoteBlocks('before\n' + block('path="A/b.md" mode="create"') + '\nafter');
    expect(segs).toEqual([
      { type: 'text', text: 'before\n' },
      { type: 'note', path: 'A/b.md', mode: 'create', content: '# T\nbody' },
      { type: 'text', text: '\nafter' },
    ]);
  });

  it('defaults mode to create and supports append', () => {
    const segs = parseNoteBlocks(block('path="a.md"') + '\n' + block('path="b.md" mode="append"', 'x'));
    expect(segs.filter((s) => s.type === 'note')).toEqual([
      { type: 'note', path: 'a.md', mode: 'create', content: '# T\nbody' },
      { type: 'note', path: 'b.md', mode: 'append', content: 'x' },
    ]);
  });

  it('keeps invalid blocks as plain text (missing path, bad mode, non-md)', () => {
    for (const attrs of ['mode="create"', 'path="a.md" mode="delete"', 'path="a.txt"', 'path=""']) {
      const md = block(attrs);
      expect(parseNoteBlocks(md)).toEqual([{ type: 'text', text: md }]);
    }
  });

  it('leaves ordinary code fences alone', () => {
    const md = '```ts\nconst a = 1;\n```';
    expect(parseNoteBlocks(md)).toEqual([{ type: 'text', text: md }]);
  });

  it('does not emit a note for an unterminated block', () => {
    const md = '```markdaun-note path="a.md"\nstill streaming';
    expect(parseNoteBlocks(md)).toEqual([{ type: 'text', text: md }]);
  });

  it('flags blocks whose path was adjusted into the area', () => {
    const segs = parseNoteBlocks(block('path="Mutua/b.md" adjusted="true" mode="create"'));
    expect(segs).toEqual([{ type: 'note', path: 'Mutua/b.md', mode: 'create', content: '# T\nbody', adjusted: true }]);
  });
});
