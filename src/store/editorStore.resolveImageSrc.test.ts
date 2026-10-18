import { describe, it, expect } from 'vitest';
import { resolveImageSrc } from './editorStore';

describe('resolveImageSrc', () => {
  it('keeps remote URLs', () => {
    expect(resolveImageSrc('https://x.com/a.png', '/vault')).toBe('https://x.com/a.png');
  });

  it('resolves relative paths against the note directory', () => {
    expect(decodeURIComponent(resolveImageSrc('img/a.png', '/vault/notes'))).toContain('/vault/notes/img/a.png');
  });
});
