import { describe, expect, it } from 'vitest';
import { resolveEmbed, resolveImagePath, resolveWikilink } from './resolve';

describe('resolveWikilink', () => {
  it('tie-break: same folder, then shortest, then alphabetical', () => {
    const md = ['b/Nota.md', 'a/deep/Nota.md', 'a/Nota.md', 'c/Nota.md'];
    expect(resolveWikilink('nota', 'a/x.md', md)).toBe('a/Nota.md');
    expect(resolveWikilink('nota', 'z/x.md', md)).toBe('a/Nota.md');
    expect(resolveWikilink('Nota', 'z/x.md', ['k/Nota.md', 'b/Nota.md', 'b/c/Nota.md'])).toBe('b/Nota.md');
  });
  it('alias and heading', () => {
    const md = ['Recetas/Tarta de limón.md'];
    expect(resolveWikilink('Tarta de limón|la tarta', 'x.md', md)).toBe(md[0]);
    expect(resolveWikilink('tarta de limón#Pasos', 'x.md', md)).toBe(md[0]);
    expect(resolveWikilink('Tarta de limón#Pasos|alias', 'x.md', md)).toBe(md[0]);
  });
  it('returns null when missing or hidden', () => {
    expect(resolveWikilink('nada', 'x.md', ['a.md'])).toBeNull();
    expect(resolveWikilink('a', 'x.md', ['.trash/a.md'])).toBeNull();
  });
});

describe('resolveImagePath', () => {
  const base = 'Personal/Recetas/scoolinary/x/receta.md';
  it('relative ../ image', () => {
    const all = ['Personal/Recetas/scoolinary/media/0413_completo.jpg'];
    expect(resolveImagePath('../media/0413_completo.jpg', base, all)).toBe(all[0]);
    expect(resolveImagePath('../../../../../up.jpg', base, all)).toBeNull();
  });
  it('encoded spaces and accents', () => {
    const all = ['Personal/Recetas/scoolinary/media/Fotografía final.jpg'];
    expect(resolveImagePath('../media/Fotograf%C3%ADa%20final.jpg', base, all)).toBe(all[0]);
    expect(resolveImagePath('../media/Fotografía final.jpg', base, all)).toBe(all[0]);
    // NFD on disk, NFC in the link
    const nfd = ['m/Fotografía.jpg'];
    expect(resolveImagePath('Fotografía.jpg', 'm/n.md', nfd)).toBe(nfd[0]);
  });
  it('root-absolute', () => {
    expect(resolveImagePath('/img/a.png', 'x/y/n.md', ['img/a.png'])).toBe('img/a.png');
  });
  it('external urls pass through unchanged', () => {
    expect(resolveImagePath('https://e.com/a.png', 'n.md', [])).toBe('https://e.com/a.png');
    expect(resolveImagePath('http://e.com/a.png', 'n.md', [])).toBe('http://e.com/a.png');
  });
  it('null when unresolvable or hidden', () => {
    expect(resolveImagePath('nope.png', 'n.md', ['a.png'])).toBeNull();
    expect(resolveImagePath('.h/a.png', 'n.md', ['.h/a.png'])).toBeNull();
  });
  it('obsidian embed by file name with tie-break', () => {
    const all = ['z/pic.png', 'a/media/pic.png', 'a/pic.png'];
    expect(resolveEmbed('pic.png', 'a/n.md', all)).toBe('a/pic.png');
    expect(resolveEmbed('PIC.png|200', 'q/n.md', all)).toBe('a/pic.png');
    expect(resolveEmbed('x.png', 'q/n.md', all)).toBeNull();
  });
});
