import { describe, it, expect } from 'vitest';
import {
  attachmentKindOf,
  chatAttachmentFromAbs,
  needsRasterize,
  toVaultRelative,
} from './types';

describe('attachment types helpers', () => {
  it('classifies images and pdfs by extension, case-insensitively', () => {
    expect(attachmentKindOf('/v/a.PNG')).toBe('image');
    expect(attachmentKindOf('/v/a.svg')).toBe('image');
    expect(attachmentKindOf('/v/a.pdf')).toBe('pdf');
    expect(attachmentKindOf('/v/a.md')).toBeNull();
    expect(attachmentKindOf('/v/noext')).toBeNull();
  });

  it('only non-direct formats need rasterizing', () => {
    expect(needsRasterize('/v/a.png')).toBe(false);
    expect(needsRasterize('/v/a.webp')).toBe(false);
    expect(needsRasterize('/v/a.svg')).toBe(true);
    expect(needsRasterize('/v/a.bmp')).toBe(true);
    expect(needsRasterize('/v/a.pdf')).toBe(false);
  });

  it('converts absolute paths to vault-relative ones and rejects outsiders', () => {
    expect(toVaultRelative('/v/sub/a.png', '/v')).toBe('sub/a.png');
    expect(toVaultRelative('/v/sub/a.png', '/v/')).toBe('sub/a.png');
    expect(toVaultRelative('/other/a.png', '/v')).toBeNull();
    expect(toVaultRelative('/vault2/a.png', '/v')).toBeNull();
    expect(toVaultRelative('C:\\v\\sub\\a.png', 'C:\\v')).toBe('sub/a.png');
  });

  it('builds a chat attachment only for supported files inside the vault', () => {
    expect(chatAttachmentFromAbs('/v/d/flujo.png', '/v')).toEqual({
      vaultPath: 'd/flujo.png',
      absPath: '/v/d/flujo.png',
      name: 'flujo.png',
      kind: 'image',
    });
    expect(chatAttachmentFromAbs('/v/n.md', '/v')).toBeNull();
    expect(chatAttachmentFromAbs('/x/n.png', '/v')).toBeNull();
  });
});
