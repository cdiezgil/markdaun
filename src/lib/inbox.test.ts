import { describe, it, expect } from 'vitest';
import { captureToast, formatSize, kindLabel } from './inbox';

describe('formatSize', () => {
  it('uses B, KB and MB', () => {
    expect(formatSize(0)).toBe('0 B');
    expect(formatSize(512)).toBe('512 B');
    expect(formatSize(2048)).toBe('2 KB');
    expect(formatSize(1536)).toBe('1,5 KB');
    expect(formatSize(5 * 1024 * 1024)).toBe('5 MB');
  });
});

describe('kindLabel', () => {
  it('names every kind in Spanish', () => {
    expect(kindLabel('md')).toBe('Markdown');
    expect(kindLabel('txt')).toBe('Texto');
    expect(kindLabel('pdf')).toBe('PDF');
    expect(kindLabel('image')).toBe('Imagen');
    expect(kindLabel('docx')).toBe('Word');
    expect(kindLabel('pptx')).toBe('PowerPoint');
    expect(kindLabel('other')).toBe('Otro');
  });
});

describe('captureToast', () => {
  it('confirms a saved capture', () => {
    expect(captureToast({ kind: 'note', rel_path: 'Entrada/C.md', clipped: null, failure: null })).toBe('Guardado en Entrada');
    expect(captureToast({ kind: 'clip', rel_path: 'Entrada/A.md', clipped: true, failure: null })).toBe('Guardado en Entrada');
  });
  it('says when only the link was kept', () => {
    expect(captureToast({ kind: 'clip', rel_path: 'Entrada/h.md', clipped: false, failure: 'HTTP 404' })).toBe(
      'No se pudo recortar la página (HTTP 404). Guardé el enlace en Entrada.',
    );
  });
});
