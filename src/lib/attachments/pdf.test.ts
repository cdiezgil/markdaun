import { describe, it, expect, vi } from 'vitest';
import { inspectPdf } from './pdf';

// In Node there is no dev server to resolve the `?url` asset: point pdf.js at the real worker file.
vi.mock('pdfjs-dist/legacy/build/pdf.worker.min.mjs?url', () => ({
  default:
    'file://' +
    (globalThis as unknown as { process: { cwd(): string } }).process.cwd() +
    '/node_modules/pdfjs-dist/legacy/build/pdf.worker.min.mjs',
}));

/** Minimal valid PDF with `pages` pages, each carrying the text "Hola PDF <n>". */
function makePdf(pages: number): Uint8Array {
  const objs: string[] = [];
  const kids = Array.from({ length: pages }, (_, i) => `${4 + i * 2} 0 R`).join(' ');
  objs.push('<< /Type /Catalog /Pages 2 0 R >>');
  objs.push(`<< /Type /Pages /Kids [${kids}] /Count ${pages} >>`);
  objs.push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  for (let i = 0; i < pages; i++) {
    const stream = `BT /F1 24 Tf 20 100 Td (Hola PDF ${i + 1}) Tj ET`;
    objs.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Resources << /Font << /F1 3 0 R >> >> /Contents ${5 + i * 2} 0 R >>`,
    );
    objs.push(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
  }
  let out = '%PDF-1.4\n';
  const offsets: number[] = [];
  objs.forEach((o, i) => {
    offsets.push(out.length);
    out += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
  offsets.forEach((o) => (out += `${String(o).padStart(10, '0')} 00000 n \n`));
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return new TextEncoder().encode(out);
}

describe('inspectPdf', () => {
  it('extracts page count and text from every page', async () => {
    const r = await inspectPdf(makePdf(2), { renderPages: false });
    expect(r.pageCount).toBe(2);
    expect(r.text).toContain('Hola PDF 1');
    expect(r.text).toContain('Hola PDF 2');
    expect(r.images).toEqual([]);
  });

  it('renders pages through the injected renderer when asked', async () => {
    const renderPage = vi.fn(async () => 'data:image/png;base64,QUJD');
    const r = await inspectPdf(makePdf(2), { renderPages: true, renderPage });
    expect(renderPage).toHaveBeenCalledTimes(2);
    expect(r.images).toEqual([
      { mediaType: 'image/png', dataB64: 'QUJD' },
      { mediaType: 'image/png', dataB64: 'QUJD' },
    ]);
  });

  it('decides rendering from the page count and caps at 20 pages', async () => {
    const renderPage = vi.fn(async () => 'data:image/png;base64,QUJD');
    const decide = vi.fn((n: number) => n > 20);
    const r = await inspectPdf(makePdf(22), { renderPages: decide, renderPage });
    expect(decide).toHaveBeenCalledWith(22);
    expect(r.pageCount).toBe(22);
    expect(r.images).toHaveLength(20);
    expect(renderPage).toHaveBeenCalledTimes(20);
    expect(r.text).toContain('Hola PDF 20');
    expect(r.text).not.toContain('Hola PDF 21');
  });
});
