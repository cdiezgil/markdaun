/** Pure counting helpers for the status bar. */

const WORDS_PER_MINUTE = 200;

function stripSyntax(md: string): string {
  return md
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1') // links/images: keep text only
    .replace(/^\s{0,3}(?:#{1,6}|[-*+]|\d+[.)]|>)\s+/gm, ' ') // heading/list/quote markers
    .replace(/[*_~=`|]+/g, ' '); // emphasis, highlight, code, table pipes
}

export function countWords(text: string): number {
  return stripSyntax(text)
    .split(/\s+/u)
    .filter((t) => /[\p{L}\p{N}]/u.test(t)).length;
}

export function countBytes(text: string): number {
  return new TextEncoder().encode(text).length;
}

export function countLines(text: string): number {
  return text === '' ? 0 : text.replace(/\n$/, '').split('\n').length;
}

export function readingTime(words: number): string {
  if (words < WORDS_PER_MINUTE) return '<1 min';
  return `~${Math.round(words / WORDS_PER_MINUTE)} min`;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
