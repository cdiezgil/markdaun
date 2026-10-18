/** The quick-capture window loads the same bundle with this URL hash. */
export const QUICK_CAPTURE_HASH = '#quick-capture';

export function isQuickCaptureHash(hash: string): boolean {
  return hash === QUICK_CAPTURE_HASH;
}
