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
  it('sanitizes', () => {
    const h = r('<script>alert(1)</script>\n\n<img src=x onerror="alert(1)">\n\n[a](javascript:alert(1))').html;
    expect(h).not.toContain('<script');
    expect(h).not.toContain('<img');
    expect(h).not.toContain('href="javascript');
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

describe('renderNote sanitizer backstop', () => {
  it('drops event handlers and script even if markup slipped through', () => {
    // Simulates raw HTML reaching DOMPurify (html:false normally escapes it).
    const h = renderNote('```\n<img src=x onerror=alert(1)>\n```', { path: 'a.md', mdPaths: [], allPaths: [] }).html;
    expect(h).not.toContain('<img');
  });
});
