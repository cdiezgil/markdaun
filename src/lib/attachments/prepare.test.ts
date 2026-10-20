import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ChatAttachment } from './types';

const inspectPdf = vi.fn();
const rasterizeImage = vi.fn();
const readFile = vi.fn();
vi.mock('./pdf', () => ({ inspectPdf: (...a: unknown[]) => inspectPdf(...a) }));
vi.mock('./rasterize', () => ({ rasterizeImage: (...a: unknown[]) => rasterizeImage(...a) }));
vi.mock('@tauri-apps/plugin-fs', () => ({ readFile: (...a: unknown[]) => readFile(...a) }));

import { prepareAttachments } from './prepare';

const png: ChatAttachment = { vaultPath: 'a.png', absPath: '/v/a.png', name: 'a.png', kind: 'image' };
const svg: ChatAttachment = { vaultPath: 'd.svg', absPath: '/v/d.svg', name: 'd.svg', kind: 'image' };
const pdf: ChatAttachment = { vaultPath: 'f.pdf', absPath: '/v/f.pdf', name: 'f.pdf', kind: 'pdf' };

beforeEach(() => {
  inspectPdf.mockReset();
  rasterizeImage.mockReset();
  readFile.mockReset();
  readFile.mockResolvedValue(new Uint8Array([1, 2, 3]));
});

describe('prepareAttachments', () => {
  it('sends direct raster images by path only', async () => {
    const r = await prepareAttachments([png], { nativePdf: true });
    expect(r.inputs).toEqual([{ vaultPath: 'a.png' }]);
    expect(rasterizeImage).not.toHaveBeenCalled();
    expect(readFile).not.toHaveBeenCalled();
  });

  it('rasterizes SVGs via blob URL (not asset://)', async () => {
    const createObjectURL = vi.fn().mockReturnValue('blob:mock-svg');
    const revokeObjectURL = vi.fn();
    vi.stubGlobal('URL', { createObjectURL, revokeObjectURL });
    rasterizeImage.mockResolvedValue({ mediaType: 'image/png', dataB64: 'QUJD' });
    const r = await prepareAttachments([svg], { nativePdf: true });
    expect(readFile).toHaveBeenCalledWith('/v/d.svg');
    expect(createObjectURL).toHaveBeenCalledWith(expect.any(Blob));
    expect(rasterizeImage).toHaveBeenCalledWith('blob:mock-svg');
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:mock-svg');
    expect(r.inputs).toEqual([
      { vaultPath: 'd.svg', derived: { images: [{ mediaType: 'image/png', dataB64: 'QUJD' }] } },
    ]);
    vi.unstubAllGlobals();
  });

  it('native-PDF engines get no page images for short PDFs', async () => {
    inspectPdf.mockResolvedValue({ pageCount: 3, text: 'hola', images: [] });
    const r = await prepareAttachments([pdf], { nativePdf: true });
    const opts = inspectPdf.mock.calls[0][1] as { renderPages: (n: number) => boolean };
    expect(opts.renderPages(3)).toBe(false);
    expect(opts.renderPages(21)).toBe(true);
    expect(r.inputs[0]).toEqual({
      vaultPath: 'f.pdf',
      derived: { images: [], text: 'hola', pageCount: 3 },
    });
    expect(r.notices).toEqual([]);
  });

  it('non-native engines always render pages', async () => {
    inspectPdf.mockResolvedValue({
      pageCount: 1,
      text: 't',
      images: [{ mediaType: 'image/png', dataB64: 'P1' }],
    });
    await prepareAttachments([pdf], { nativePdf: false });
    expect((inspectPdf.mock.calls[0][1] as { renderPages: boolean }).renderPages).toBe(true);
  });

  it('notifies when only the first 20 pages are used', async () => {
    inspectPdf.mockResolvedValue({ pageCount: 31, text: '', images: [] });
    const r = await prepareAttachments([pdf], { nativePdf: true });
    expect(r.notices[0]).toMatch(/31 páginas.*20 primeras/);
  });

  it('turns a failing read into a Spanish error naming the file', async () => {
    readFile.mockRejectedValueOnce(new Error('ENOENT'));
    await expect(prepareAttachments([pdf], { nativePdf: true })).rejects.toThrow(/f\.pdf/);
  });
});
