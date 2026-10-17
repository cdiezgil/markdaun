import {
  attachmentKindOf,
  chatAttachmentFromAbs,
  MAX_ATTACHMENTS,
  type ChatAttachment,
} from './types';

export interface NoteAttachments {
  attachments: ChatAttachment[];
  /** Local references beyond MAX_ATTACHMENTS. */
  extra: number;
  /** Remote URLs / data URIs skipped. */
  remote: number;
  /** Local references resolving outside the vault, skipped. */
  outside: number;
}

const LINK_RE = /!?\[[^\]]*\]\(\s*(<[^>]*>|[^)\s]+)(?:\s+"[^"]*")?\s*\)/g;

/** Normalizes `.`/`..` segments of an absolute POSIX-style path. */
function normalize(path: string): string {
  const out: string[] = [];
  for (const seg of path.split('/')) {
    if (seg === '' || seg === '.') continue;
    if (seg === '..') out.pop();
    else out.push(seg);
  }
  return '/' + out.join('/');
}

function decode(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

/**
 * Local images / PDFs referenced by a note (Markdown image or link syntax), paths
 * resolved against the note and kept inside the vault. `markdown` must use the
 * on-disk form (relative paths), not the editor's asset URLs.
 */
export function collectNoteAttachments(markdown: string, notePath: string, vaultPath: string): NoteAttachments {
  const noteDir = notePath.slice(0, notePath.lastIndexOf('/'));
  const vault = normalize(vaultPath);
  const seen = new Set<string>();
  const found: ChatAttachment[] = [];
  let remote = 0;
  let outside = 0;

  for (const m of markdown.matchAll(LINK_RE)) {
    let src = m[1];
    if (src.startsWith('<') && src.endsWith('>')) src = src.slice(1, -1);
    src = decode(src.trim());
    if (/^(https?:)?\/\//i.test(src) || /^data:/i.test(src)) {
      if (attachmentKindOf(src.split(/[?#]/)[0]) !== null || /^data:/i.test(src)) remote++;
      continue;
    }
    if (/^[a-z][a-z0-9+.-]*:/i.test(src)) continue; // mailto:, tauri:, …
    const clean = src.split(/[?#]/)[0];
    if (attachmentKindOf(clean) === null) continue;
    const abs = normalize(clean.startsWith('/') ? clean : `${noteDir}/${clean}`);
    const att = abs.startsWith(vault + '/') ? chatAttachmentFromAbs(abs, vault) : null;
    if (!att) {
      outside++;
      continue;
    }
    if (seen.has(att.vaultPath)) continue;
    seen.add(att.vaultPath);
    found.push(att);
  }

  return {
    attachments: found.slice(0, MAX_ATTACHMENTS),
    extra: Math.max(0, found.length - MAX_ATTACHMENTS),
    remote,
    outside,
  };
}

/** Spanish notices for what was skipped or truncated. */
export function describeSkipped(r: NoteAttachments): string[] {
  const out: string[] = [];
  if (r.remote > 0) {
    out.push(`Se omitieron ${r.remote} imagen(es) remotas: solo se adjuntan archivos locales.`);
  }
  if (r.extra > 0) {
    out.push(`Hay ${r.extra} archivo(s) más: solo se adjuntan los ${MAX_ATTACHMENTS} primeros.`);
  }
  if (r.outside > 0) {
    out.push(`Se omitieron ${r.outside} archivo(s) fuera de la bóveda.`);
  }
  return out;
}
