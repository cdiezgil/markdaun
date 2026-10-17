import { describe, it, expect } from 'vitest';
import { defaultNotePath, embedLine, explainInNotePrompt, explainNoteImagesPrompt } from './prompts';
import { parseNoteBlocks } from '../chat/noteBlocks';
import type { ChatAttachment } from './types';

const img: ChatAttachment = { vaultPath: 'diagramas/flujo.png', absPath: '/v/diagramas/flujo.png', name: 'flujo.png', kind: 'image' };
const pdf: ChatAttachment = { vaultPath: 'doc.pdf', absPath: '/v/doc.pdf', name: 'doc.pdf', kind: 'pdf' };

describe('defaultNotePath', () => {
  it('keeps the folder and base name with .md', () => {
    expect(defaultNotePath('diagramas/flujo.png')).toBe('diagramas/flujo.md');
    expect(defaultNotePath('doc.pdf')).toBe('doc.md');
    expect(defaultNotePath('a/b.c/foto.final.jpeg')).toBe('a/b.c/foto.final.md');
  });
});

describe('embedLine', () => {
  it('embeds images and links PDFs relative to the note', () => {
    expect(embedLine(img)).toBe('![](flujo.png)');
    expect(embedLine(pdf)).toBe('[doc.pdf](doc.pdf)');
  });

  it('percent-encodes spaces so the Markdown link stays valid', () => {
    expect(embedLine({ ...img, name: 'mi flujo.png' })).toBe('![](mi%20flujo.png)');
  });
});

describe('explainInNotePrompt', () => {
  it('asks for a create block at the default path starting with the embed', () => {
    const p = explainInNotePrompt(img);
    expect(p).toContain('flujo.png');
    expect(p).toContain('path="diagramas/flujo.md"');
    expect(p).toContain('mode="create"');
    expect(p).toContain('![](flujo.png)');
  });

  it('uses the PDF link form for PDFs', () => {
    expect(explainInNotePrompt(pdf)).toContain('[doc.pdf](doc.pdf)');
  });

  it('its example block round-trips through the note block parser', () => {
    const blocks = parseNoteBlocks(explainInNotePrompt(img));
    // The prompt documents the format inline; it must not be mistaken for a real proposal.
    expect(blocks.every((b) => b.type !== 'note')).toBe(true);
  });
});

describe('explainNoteImagesPrompt', () => {
  it('includes the note text and name', () => {
    const p = explainNoteImagesPrompt('Mi nota', 'Texto de la nota con ![](a.png)');
    expect(p).toContain('Mi nota');
    expect(p).toContain('Texto de la nota con ![](a.png)');
    expect(p).toMatch(/imágenes/);
  });
});
