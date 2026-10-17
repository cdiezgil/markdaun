import { describe, it, expect } from 'vitest';
import { collectNoteAttachments } from './noteRefs';

const NOTE = '/v/notas/idea.md';

describe('collectNoteAttachments', () => {
  it('finds images and PDFs, resolving paths relative to the note', () => {
    const md = '![a](flujo.png)\ntexto [doc](../docs/spec.pdf) y ![b](sub/x.svg)';
    const r = collectNoteAttachments(md, NOTE, '/v');
    expect(r.attachments.map((a) => a.vaultPath)).toEqual(['notas/flujo.png', 'docs/spec.pdf', 'notas/sub/x.svg']);
    expect(r.attachments.map((a) => a.kind)).toEqual(['image', 'pdf', 'image']);
    expect(r.attachments[0].absPath).toBe('/v/notas/flujo.png');
  });

  it('ignores ordinary links and non-attachable files', () => {
    const r = collectNoteAttachments('[otra](otra.md) [web](https://a.com/p) ![x](a.txt)', NOTE, '/v');
    expect(r.attachments).toEqual([]);
    expect(r.remote).toBe(0);
  });

  it('skips remote URLs and counts them', () => {
    const md = '![a](https://x.com/a.png) ![b](http://y.com/b.png) ![c](//cdn/c.png) ![d](data:image/png;base64,AAA)';
    const r = collectNoteAttachments(md, NOTE, '/v');
    expect(r.attachments).toEqual([]);
    expect(r.remote).toBe(4);
  });

  it('drops paths that escape the vault and counts them', () => {
    const r = collectNoteAttachments('![a](../../secret.png) ![b](/etc/x.png)', NOTE, '/v');
    expect(r.attachments).toEqual([]);
    expect(r.outside).toBe(2);
  });

  it('accepts absolute paths that are inside the vault', () => {
    const r = collectNoteAttachments('![a](/v/otra/img.png)', NOTE, '/v');
    expect(r.attachments.map((a) => a.vaultPath)).toEqual(['otra/img.png']);
  });

  it('decodes percent-encoding, strips <> and link titles, and dedupes', () => {
    const md = '![a](mi%20flujo.png) ![b](<mi flujo.png>) ![c](x.png "titulo")';
    const r = collectNoteAttachments(md, NOTE, '/v');
    expect(r.attachments.map((a) => a.name)).toEqual(['mi flujo.png', 'x.png']);
  });

  it('keeps the first five and reports the extra ones', () => {
    const md = Array.from({ length: 8 }, (_, i) => `![](i${i}.png)`).join(' ');
    const r = collectNoteAttachments(md, NOTE, '/v');
    expect(r.attachments).toHaveLength(5);
    expect(r.extra).toBe(3);
  });
});
