import { describe, it, expect } from 'vitest';
import { resolveImageSrc } from './editorStore';

describe('resolveImageSrc', () => {
  it('keeps remote https URLs', () => {
    expect(resolveImageSrc('https://x.com/a.png', '/vault')).toBe('https://x.com/a.png');
  });

  it('keeps tauri:// URLs (Tauri v1 asset format) unchanged', () => {
    const url = 'tauri://localhost/vault/notes/img/a.png';
    expect(resolveImageSrc(url, '/vault/notes')).toBe(url);
  });

  it('keeps asset:// URLs (Tauri v2 macOS/Linux format) unchanged', () => {
    const url = 'asset://localhost/vault/notes/img/a.png';
    expect(resolveImageSrc(url, '/vault/notes')).toBe(url);
  });

  it('resolves relative paths against the note directory', () => {
    expect(decodeURIComponent(resolveImageSrc('img/a.png', '/vault/notes'))).toContain('/vault/notes/img/a.png');
  });

  it('resolves ./relative paths', () => {
    expect(decodeURIComponent(resolveImageSrc('./img/a.png', '/vault/notes'))).toContain('/vault/notes/img/a.png');
  });
});
