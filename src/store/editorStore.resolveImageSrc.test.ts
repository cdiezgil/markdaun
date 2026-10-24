import { describe, it, expect } from 'vitest';
import { resolveImageSrc, processImagesOnLoad, processImagesOnSave } from './editorStore';

describe('resolveImageSrc', () => {
  it('keeps remote URLs unchanged', () => {
    expect(resolveImageSrc('https://x.com/a.png', '/vault')).toBe('https://x.com/a.png');
    expect(resolveImageSrc('http://x.com/a.gif', '/vault')).toBe('http://x.com/a.gif');
    expect(resolveImageSrc('data:image/png;base64,abc', '/vault')).toBe('data:image/png;base64,abc');
    expect(resolveImageSrc('asset://localhost/vault/a.jpg', '/vault')).toBe('asset://localhost/vault/a.jpg');
    expect(resolveImageSrc('tauri://localhost/vault/a.jpg', '/vault')).toBe('tauri://localhost/vault/a.jpg');
  });

  it('normalizes double leading slashes //Users/... without stripping /Users', () => {
    const src = '//Users/carlosdiez/Documents/markdaun/Personal/Recetas/elbulli-catalogo-md/media/recipes/0001_completo.jpg';
    const resolved = resolveImageSrc(src, '/Users/carlosdiez/Documents/markdaun/Personal/Recetas');
    expect(resolved).toBe('asset:///Users/carlosdiez/Documents/markdaun/Personal/Recetas/elbulli-catalogo-md/media/recipes/0001_completo.jpg');
  });

  it('resolves absolute local paths directly', () => {
    const resolved = resolveImageSrc('/Users/carlosdiez/foto.jpg', '/Users/carlosdiez/notes');
    expect(resolved).toBe('asset:///Users/carlosdiez/foto.jpg');
  });

  it('resolves relative paths against noteDir, including parent traversals', () => {
    const resolved = resolveImageSrc('../../media/recipes/0001.jpg', '/Users/carlosdiez/notes/sub/deep');
    expect(resolved).toBe('asset:///Users/carlosdiez/notes/media/recipes/0001.jpg');
  });

  it('decodes encoded spaces (%20) and UTF-8 characters', () => {
    const resolved = resolveImageSrc('media/recetas/gel%C3%A9e%20de%20oporto.jpg', '/vault/notes');
    expect(resolved).toBe('asset:///vault/notes/media/recetas/gelée de oporto.jpg');
  });

  it('handles spaces directly in path', () => {
    const resolved = resolveImageSrc('media/recetas/tarta de queso.gif', '/vault/notes');
    expect(resolved).toBe('asset:///vault/notes/media/recetas/tarta de queso.gif');
  });
});

describe('processImagesOnLoad', () => {
  it('converts markdown images to resolved asset URLs', () => {
    const md = 'Foto: ![Terrina](//Users/carlosdiez/img/foto.jpg) y ![Anim](anim.gif)';
    const out = processImagesOnLoad(md, '/Users/carlosdiez/notes');
    expect(out).toBe('Foto: ![Terrina](asset:///Users/carlosdiez/img/foto.jpg) y ![Anim](asset:///Users/carlosdiez/notes/anim.gif)');
  });

  it('preserves remote image URLs in markdown', () => {
    const md = '![cat](https://cdn.example.com/cat.gif)';
    expect(processImagesOnLoad(md, '/vault')).toBe(md);
  });
});

describe('processImagesOnSave', () => {
  it('converts asset URLs in subdirectories to relative paths', () => {
    const md = '![Foto](asset:///vault/notes/img/a.png)';
    expect(processImagesOnSave(md, '/vault/notes')).toBe('![Foto](img/a.png)');
  });

  it('converts asset URLs across sibling/parent directories to relative paths (e.g. recipe catalog)', () => {
    const noteDir = '/Users/carlosdiez/Documents/markdaun/Personal/Recetas/elbulli-catalogo-md/recipes/1983-1993';
    const md = '![Terrina](asset:///Users/carlosdiez/Documents/markdaun/Personal/Recetas/elbulli-catalogo-md/media/recipes/0001_completo.jpg)';
    expect(processImagesOnSave(md, noteDir)).toBe('![Terrina](../../media/recipes/0001_completo.jpg)');
  });

  it('converts local paths starting with //Users/... to relative paths on save', () => {
    const noteDir = '/Users/carlosdiez/Documents/markdaun/Personal/Recetas/elbulli-catalogo-md/recipes/1983-1993';
    const md = '![Terrina](//Users/carlosdiez/Documents/markdaun/Personal/Recetas/elbulli-catalogo-md/media/recipes/0001_completo.jpg)';
    expect(processImagesOnSave(md, noteDir)).toBe('![Terrina](../../media/recipes/0001_completo.jpg)');
  });

  it('converts http://asset.localhost URLs (Windows) to relative paths', () => {
    const md = '![Foto](http://asset.localhost/vault/notes/img/a.png)';
    expect(processImagesOnSave(md, '/vault/notes')).toBe('![Foto](img/a.png)');
  });

  it('preserves remote image URLs on save', () => {
    const md = '![cat](https://cdn.example.com/cat.gif)';
    expect(processImagesOnSave(md, '/vault')).toBe('![cat](https://cdn.example.com/cat.gif)');
  });

  it('correctly converts multiple images within markdown table rows on save', () => {
    const noteDir = '/Users/carlosdiez/Documents/markdaun/Personal/Recetas/elbulli-catalogo-md/recipes/1983-1993';
    const tableRow = '| ![Terrina de melón con gelée de oporto - Plato Completo](//Users/carlosdiez/Documents/markdaun/Personal/Recetas/elbulli-catalogo-md/media/recipes/0001_completo.jpg) | ![Terrina de melón con gelée de oporto - Detalle](//Users/carlosdiez/Documents/markdaun/Personal/Recetas/elbulli-catalogo-md/media/recipes/0001_detalle.jpg) |';
    const expected = '| ![Terrina de melón con gelée de oporto - Plato Completo](../../media/recipes/0001_completo.jpg) | ![Terrina de melón con gelée de oporto - Detalle](../../media/recipes/0001_detalle.jpg) |';
    expect(processImagesOnSave(tableRow, noteDir)).toBe(expected);
  });
});

