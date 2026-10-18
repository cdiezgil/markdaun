import { describe, it, expect } from 'vitest';
import { isQuickCaptureHash } from './windows';

describe('isQuickCaptureHash', () => {
  it('recognises the quick-capture window URL', () => {
    expect(isQuickCaptureHash('#quick-capture')).toBe(true);
  });
  it('leaves the main window alone', () => {
    expect(isQuickCaptureHash('')).toBe(false);
    expect(isQuickCaptureHash('#/inbox')).toBe(false);
  });
});
