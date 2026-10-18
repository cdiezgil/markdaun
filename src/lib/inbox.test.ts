import { describe, it, expect } from 'vitest';
import { formatSize, kindLabel } from './inbox';

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
