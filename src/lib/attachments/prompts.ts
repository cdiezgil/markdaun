import type { ChatAttachment } from './types';

/** `diagramas/flujo.png` -> `diagramas/flujo.md` (same folder, same base name). */
export function defaultNotePath(vaultPath: string): string {
  const slash = vaultPath.lastIndexOf('/');
  const dir = slash >= 0 ? vaultPath.slice(0, slash + 1) : '';
  const file = vaultPath.slice(slash + 1);
  const dot = file.lastIndexOf('.');
  return `${dir}${dot > 0 ? file.slice(0, dot) : file}.md`;
}

/** Line that opens the generated note: the embedded image or a link to the PDF. */
export function embedLine(a: ChatAttachment): string {
  const target = encodeURI(a.name);
  return a.kind === 'pdf' ? `[${a.name}](${target})` : `![](${target})`;
}

/** Predefined prompt of the preview's «Explicar en una nota». */
export function explainInNotePrompt(a: ChatAttachment): string {
  return [
    `Explica con detalle el contenido de «${a.name}» y devuélvelo como una nota nueva.`,
    `Responde con un único bloque markdaun-note con path="${defaultNotePath(a.vaultPath)}" y mode="create".`,
    `El contenido de la nota debe empezar con la línea ${embedLine(a)} y continuar con la explicación en Markdown.`,
  ].join('\n');
}

/** Predefined prompt of the editor's «Explicar imágenes de esta nota». */
export function explainNoteImagesPrompt(noteName: string, noteText: string): string {
  return [
    `Explica las imágenes y PDFs adjuntos de mi nota «${noteName}», teniendo en cuenta su texto:`,
    '',
    noteText,
  ].join('\n');
}
