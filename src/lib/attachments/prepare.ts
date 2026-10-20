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
      // Read via plugin-fs (scoped) and create a blob URL so the <img> element
      // can load the file without needing the asset:// protocol scope.
      const bytes = await readBytes(att);
      const blob = new Blob([bytes], { type: mimeForPath(att.absPath) });
      const blobUrl = URL.createObjectURL(blob);
      try {
        const image = await rasterizeImage(blobUrl);
        inputs.push({ vaultPath: att.vaultPath, derived: { images: [image] } });
      } finally {
        URL.revokeObjectURL(blobUrl);
      }
    } else {
      inputs.push({ vaultPath: att.vaultPath });
    }
  }
  return { inputs, notices };
}
