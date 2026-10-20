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
      const { convertFileSrc } = await import('@tauri-apps/api/core');
      const image = await rasterizeImage(convertFileSrc(att.absPath));
      inputs.push({ vaultPath: att.vaultPath, derived: { images: [image] } });
    } else {
      inputs.push({ vaultPath: att.vaultPath });
    }
  }
  return { inputs, notices };
}
