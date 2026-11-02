import { describe, expect, it } from 'vitest';
import { renderNote } from './render';

const ctx = {
  path: 'Cocina/n.md',
  mdPaths: ['Cocina/n.md', 'Cocina/Tarta.md'],
  allPaths: ['Cocina/n.md', 'Cocina/Tarta.md', 'media/a b.jpg', 'Cocina/pic.png'],
};
const r = (md: string) => renderNote(md, ctx);

describe('renderNote', () => {
  it('resolves wikilinks to data-note', () => {
    expect(r('ver [[tarta|la tarta]]').html).toContain('<a data-note="Cocina/Tarta.md">la tarta</a>');
  });
  it('renders broken link as broken', () => {
    expect(r('[[nada]]').html).toContain('<span class="broken">nada</span>');
  });
  it('tags and highlights', () => {
    const h = r('hola #cena y ==clave==').html;
    expect(h).toContain('<span class="tag">#cena</span>');
    expect(h).toContain('<mark>clave</mark>');
    expect(r('# Titulo').html).not.toContain('class="tag"');
  });
  it('images: vault path to data-src, external to src, deduped', () => {
    const res = r('![x](../media/a%20b.jpg) ![y](../media/a%20b.jpg) ![[pic.png]] ![z](https://e.com/z.png) ![m](gone.png)');
    expect(res.html).toContain('data-src="media/a b.jpg"');
    expect(res.html).toContain('data-src="Cocina/pic.png"');
    expect(res.html).toContain('src="https://e.com/z.png"');
    expect(res.html).not.toContain('data-src="https');
    expect([...res.images].sort()).toEqual(['Cocina/pic.png', 'media/a b.jpg']);
  });
  it('sanitizes hostile raw HTML but keeps benign tags', () => {
    const h = r(
      [
        '<script>alert(1)</script>',
        '',
        '<img src=x onerror=alert(1)>',
        '',
        '<a href="javascript:alert(1)">x</a>',
        '',
        '<iframe src="https://evil.example"></iframe>',
        '',
        '<form action="/x"><input name="a"></form>',
        '',
        'a<br>b <kbd>Ctrl</kbd>',
        '',
        '<details><summary>más</summary>oculto</details>',
      ].join('\n'),
    ).html;
    expect(h).not.toContain('<script');
    expect(h).not.toContain('onerror');
    expect(h).not.toContain('javascript:');
    expect(h).not.toContain('<iframe');
    expect(h).not.toContain('<form');
    expect(h).not.toContain('<input');
    expect(h).toContain('<br>');
    expect(h).toContain('<kbd>Ctrl</kbd>');
    expect(h).toContain('<details><summary>más</summary>oculto</details>');
  });
  it('raw HTML images resolve like Markdown images', () => {
    const res = r('<img src="../media/a%20b.jpg" alt="p"> <img src="https://e.com/z.png"> <img src="gone.png" alt="g"> <img src="data:image/png;base64,AAAA">');
    expect(res.html).toContain('data-src="media/a b.jpg"');
    expect(res.html).not.toContain('src="../media');
    expect(res.html).toContain('src="https://e.com/z.png"');
    expect(res.html).toContain('<span class="broken">g</span>');
    expect(res.html).not.toContain('src="data:');
    expect(res.images).toEqual(['media/a b.jpg']);
  });
  it('detects mermaid', () => {
    const res = r('```mermaid\ngraph TD; A-->B\n```');
    expect(res.hasMermaid).toBe(true);
    expect(res.html).toContain('<div class="mermaid-src">');
    expect(r('```js\n1\n```').hasMermaid).toBe(false);
  });
  it('strips front matter', () => {
    const h = r('---\ntitle: x\n---\n\nHola').html;
    expect(h).not.toContain('title');
    expect(h).toContain('Hola');
  });
  it('renders tables', () => {
    expect(r('|a|b|\n|-|-|\n|1|2|').html).toContain('<table>');
  });
});
