import type { InboxKind, QuickSummary } from './tauri';

/** Human file size with a decimal comma (es-ES): 512 B, 1,5 KB, 5 MB. */
export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const fmt = (n: number) => String(Math.round(n * 10) / 10).replace('.', ',');
  if (bytes < 1024 * 1024) return `${fmt(bytes / 1024)} KB`;
  return `${fmt(bytes / (1024 * 1024))} MB`;
}

const KIND_LABELS: Record<InboxKind, string> = {
  md: 'Markdown',
  txt: 'Texto',
  pdf: 'PDF',
  image: 'Imagen',
  docx: 'Word',
  pptx: 'PowerPoint',
  other: 'Otro',
};

export function kindLabel(kind: InboxKind): string {
  return KIND_LABELS[kind];
}

export function formatDate(ms: number): string {
  return new Date(ms).toLocaleDateString('es-ES');
}
export const INBOX_DIR = 'Entrada';

/** User-facing text for the errors the inbox commands return. */
export function inboxErrorMessage(error: string): string {
  if (error === 'invalid_url') return 'Esa dirección no es válida. Usa una URL que empiece por http:// o https://.';
  return error;
}

export function pluralize(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** Confirmation shown in the main window after a quick capture. */
export function captureToast(s: QuickSummary): string {
  if (s.kind === 'clip' && s.clipped === false) {
    return `No se pudo recortar la página (${s.failure ?? 'motivo desconocido'}). Guardé el enlace en Entrada.`;
  }
  return 'Guardado en Entrada';
}
