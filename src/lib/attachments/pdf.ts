import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import workerUrl from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url';
import { MAX_IMAGE_SIDE, MAX_PDF_PAGES, type DerivedImage } from './types';

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

export interface PdfInspection {
  pageCount: number;
  /** Text of the first MAX_PDF_PAGES pages. */
  text: string;
  images: DerivedImage[];
}

type PdfPage = Awaited<ReturnType<Awaited<ReturnType<typeof pdfjs.getDocument>['promise']>['getPage']>>;

/** Renders one page and returns a PNG data URL. */
export type PageRenderer = (page: PdfPage) => Promise<string>;

export interface InspectOptions {
  /** Render page images (always for the first MAX_PDF_PAGES pages). */
  renderPages: boolean | ((pageCount: number) => boolean);
  renderPage?: PageRenderer;
}

export const renderPageToDataUrl: PageRenderer = async (page) => {
  const base = page.getViewport({ scale: 1 });
  const scale = Math.min(2, MAX_IMAGE_SIDE / Math.max(base.width, base.height));
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(viewport.width);
  canvas.height = Math.ceil(viewport.height);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('canvas not available');
  await page.render({ canvasContext: ctx, viewport }).promise;
  return canvas.toDataURL('image/png');
};

function splitDataUrl(url: string): DerivedImage {
  const m = /^data:([^;]+);base64,(.*)$/.exec(url);
  if (!m) throw new Error('invalid data URL');
  return { mediaType: m[1], dataB64: m[2] };
}

/** Page count, extracted text and (optionally) page images of a PDF. */
export async function inspectPdf(data: Uint8Array, opts: InspectOptions): Promise<PdfInspection> {
  const doc = await pdfjs.getDocument({ data: data.slice(), verbosity: 0 }).promise;
  try {
    const pageCount = doc.numPages;
    const used = Math.min(pageCount, MAX_PDF_PAGES);
    const render = typeof opts.renderPages === 'function' ? opts.renderPages(pageCount) : opts.renderPages;
    const renderPage = opts.renderPage ?? renderPageToDataUrl;
    const texts: string[] = [];
    const images: DerivedImage[] = [];
    for (let n = 1; n <= used; n++) {
      const page = await doc.getPage(n);
      const content = await page.getTextContent();
      const pageText = content.items
        .map((i) => ('str' in i ? i.str : ''))
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim();
      if (pageText) texts.push(pageText);
      if (render) images.push(splitDataUrl(await renderPage(page)));
    }
    return { pageCount, text: texts.join('\n\n'), images };
  } finally {
    await doc.destroy();
  }
}
