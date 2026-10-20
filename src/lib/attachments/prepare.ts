import { readFile } from '@tauri-apps/plugin-fs';
import { inspectPdf } from './pdf';
import { rasterizeImage } from './rasterize';
import {
  MAX_PDF_PAGES,
  needsRasterize,
  type AttachmentInput,
  type ChatAttachment,
} from './types';

export interface PrepareOptions {
  /** The target engine takes PDFs natively (Anthropic / Claude CLI). */
  nativePdf: boolean;
}

export interface Prepared {
  inputs: AttachmentInput[];
  /** Non-blocking messages to show in the chat (e.g. page truncation). */
  notices: string[];
}

async function readBytes(att: ChatAttachment): Promise<Uint8Array> {
  try {
    return await readFile(att.absPath);
  } catch {
    throw new Error(`No se pudo leer «${att.name}».`);
  }
}

const MIME_MAP: Record<string, string> = {
  svg: 'image/svg+xml',
  bmp: 'image/bmp',
  ico: 'image/x-icon',
  avif: 'image/avif',
  tif: 'image/tiff',
  tiff: 'image/tiff',
};

function mimeForPath(path: string): string {
  const ext = path.split('.').pop()?.toLowerCase() ?? '';
  return MIME_MAP[ext] ?? 'application/octet-stream';
}

/** Renderer-only processing (SVG rasterization, PDF pages/text); Rust does the rest. */
export async function prepareAttachments(
  attachments: ChatAttachment[],
  opts: PrepareOptions,
): Promise<Prepared> {
  const inputs: AttachmentInput[] = [];
  const notices: string[] = [];
  for (const att of attachments) {
    if (att.kind === 'pdf') {
      const info = await inspectPdf(await readBytes(att), {
        renderPages: opts.nativePdf ? (n: number) => n > MAX_PDF_PAGES : true,
      });
      if (info.pageCount > MAX_PDF_PAGES) {
        notices.push(
          `«${att.name}» tiene ${info.pageCount} páginas: solo se usan las ${MAX_PDF_PAGES} primeras.`,
        );
      }
      inputs.push({
        vaultPath: att.vaultPath,
        derived: { images: info.images, text: info.text, pageCount: info.pageCount },
      });
    } else if (needsRasterize(att.absPath)) {
      // Read via plugin-fs (scoped) then convert to a data: URL via FileReader.
      // Blob URLs taint the canvas in WKWebView ("The operation is insecure"
      // on toDataURL). Data URLs are always same-origin and never taint it.
      const bytes = await readBytes(att);
      const blob = new Blob([bytes], { type: mimeForPath(att.absPath) });
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = () => reject(new Error(`No se pudo convertir «${att.name}» a data URL.`));
        reader.readAsDataURL(blob);
      });
      const image = await rasterizeImage(dataUrl);
      inputs.push({ vaultPath: att.vaultPath, derived: { images: [image] } });
    } else {
      inputs.push({ vaultPath: att.vaultPath });
    }
  }
  return { inputs, notices };
}
