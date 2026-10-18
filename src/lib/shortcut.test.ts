import { describe, it, expect } from 'vitest';
import { acceleratorFromEvent, formatAccelerator, shortcutErrorMessage } from './shortcut';

const ev = (code: string, mods: Partial<Record<'ctrlKey' | 'altKey' | 'shiftKey' | 'metaKey', boolean>> = {}) => ({
  code,
  ctrlKey: false,
  altKey: false,
  shiftKey: false,
  metaKey: false,
  ...mods,
});

describe('acceleratorFromEvent', () => {
  it('builds Alt+Cmd+N on macOS', () => {
    expect(acceleratorFromEvent(ev('KeyN', { altKey: true, metaKey: true }), true)).toEqual({ accelerator: 'Alt+Cmd+N' });
  });

  it('builds Ctrl+Alt+N elsewhere and maps the Windows key to Super', () => {
    expect(acceleratorFromEvent(ev('KeyN', { ctrlKey: true, altKey: true }), false)).toEqual({ accelerator: 'Ctrl+Alt+N' });
    expect(acceleratorFromEvent(ev('KeyK', { metaKey: true, shiftKey: true }), false)).toEqual({ accelerator: 'Shift+Super+K' });
  });

  it('orders modifiers consistently and supports digits, function and arrow keys', () => {
    expect(acceleratorFromEvent(ev('Digit5', { shiftKey: true, ctrlKey: true }), false)).toEqual({ accelerator: 'Ctrl+Shift+5' });
    expect(acceleratorFromEvent(ev('F9', { altKey: true }), false)).toEqual({ accelerator: 'Alt+F9' });
    expect(acceleratorFromEvent(ev('ArrowUp', { ctrlKey: true }), false)).toEqual({ accelerator: 'Ctrl+Up' });
    expect(acceleratorFromEvent(ev('Space', { ctrlKey: true }), false)).toEqual({ accelerator: 'Ctrl+Space' });
  });

  it('waits while only modifiers are held', () => {
    expect(acceleratorFromEvent(ev('AltLeft', { altKey: true }), true)).toEqual({ pending: true });
    expect(acceleratorFromEvent(ev('MetaLeft', { metaKey: true }), true)).toEqual({ pending: true });
  });

  it('requires a modifier other than Shift', () => {
    expect(acceleratorFromEvent(ev('KeyN'), true)).toEqual({ error: 'modifier' });
    expect(acceleratorFromEvent(ev('KeyN', { shiftKey: true }), true)).toEqual({ error: 'modifier' });
  });

  it('cancels on Escape and rejects keys it cannot name', () => {
    expect(acceleratorFromEvent(ev('Escape'), true)).toEqual({ cancel: true });
    expect(acceleratorFromEvent(ev('IntlBackslash', { altKey: true }), true)).toEqual({ error: 'key' });
  });
});

describe('formatAccelerator', () => {
  it('uses symbols on macOS', () => {
    expect(formatAccelerator('Alt+Cmd+N', true)).toBe('⌥⌘N');
    expect(formatAccelerator('Ctrl+Shift+K', true)).toBe('⌃⇧K');
  });
  it('keeps words elsewhere', () => {
    expect(formatAccelerator('Ctrl+Alt+N', false)).toBe('Ctrl+Alt+N');
    expect(formatAccelerator('Alt+Cmd+N', false)).toBe('Alt+Win+N');
  });
});

describe('shortcutErrorMessage', () => {
  it('explains the backend errors in Spanish', () => {
    expect(shortcutErrorMessage('invalid_shortcut')).toMatch(/combinación no es válida/i);
    expect(shortcutErrorMessage('shortcut_unavailable: HotKey already registered')).toMatch(/otra aplicación/i);
    expect(shortcutErrorMessage('shortcut_unavailable: HotKey already registered')).toContain('HotKey already registered');
    expect(shortcutErrorMessage('boom')).toBe('boom');
  });
});
