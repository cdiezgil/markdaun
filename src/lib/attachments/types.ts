// Frontend mirrors of src-tauri/src/llm/attachment.rs (serde camelCase).

export type AttachmentKind = 'image' | 'pdf';

/** An attachment queued in the chat (not yet sent). */
export interface ChatAttachment {
  /** Vault-relative path (what the backend validates and reads). */
  vaultPath: string;
  /** Absolute path (used to load bytes for rasterizing / PDF inspection). */
  absPath: string;
  name: string;
  kind: AttachmentKind;
}

export interface DerivedImage {
  mediaType: string;
  dataB64: string;
}

export interface Derived {
  images: DerivedImage[];
  text?: string | null;
  pageCount?: number | null;
}

/** Payload item of `brain_query`'s `attachments`. */
export interface AttachmentInput {
  vaultPath: string;
  derived?: Derived | null;
}

export const MAX_ATTACHMENTS = 5;
export const MAX_PDF_PAGES = 20;
export const MAX_IMAGE_SIDE = 1568;

const IMAGE_EXTS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'ico', 'avif', 'tif', 'tiff']);
/** Formats the backend takes as-is (it downscales them itself). */
const DIRECT_EXTS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp']);

export function extensionOf(path: string): string {
  const base = path.split(/[\\/]/).pop() ?? '';
  const i = base.lastIndexOf('.');
  return i > 0 ? base.slice(i + 1).toLowerCase() : '';
}

export function attachmentKindOf(path: string): AttachmentKind | null {
  const ext = extensionOf(path);
  if (ext === 'pdf') return 'pdf';
  return IMAGE_EXTS.has(ext) ? 'image' : null;
}

/** True when the frontend must rasterize the image before sending. */
export function needsRasterize(path: string): boolean {
  return attachmentKindOf(path) === 'image' && !DIRECT_EXTS.has(extensionOf(path));
}

export function baseName(path: string): string {
  return path.split(/[\\/]/).pop() ?? path;
}

/** Absolute path -> vault-relative (forward slashes), or null if outside the vault. */
export function toVaultRelative(absPath: string, vaultPath: string): string | null {
  const norm = (p: string) => p.replace(/\\/g, '/').replace(/\/+$/, '');
  const a = norm(absPath);
  const v = norm(vaultPath);
  if (!a.startsWith(v + '/')) return null;
  return a.slice(v.length + 1);
}

/** Builds a ChatAttachment from an absolute path inside the vault. */
export function chatAttachmentFromAbs(absPath: string, vaultPath: string): ChatAttachment | null {
  const kind = attachmentKindOf(absPath);
  const rel = toVaultRelative(absPath, vaultPath);
  if (!kind || rel === null) return null;
  return { vaultPath: rel, absPath, name: baseName(absPath), kind };
}
