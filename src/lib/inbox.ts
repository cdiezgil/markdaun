import type { InboxKind } from './tauri';

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
  other: 'Otro',
};

export function kindLabel(kind: InboxKind): string {
  return KIND_LABELS[kind];
}

export function formatDate(ms: number): string {
  return new Date(ms).toLocaleDateString('es-ES');
}
export const INBOX_DIR = 'Entrada';
