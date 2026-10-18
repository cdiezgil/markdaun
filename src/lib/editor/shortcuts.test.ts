import { describe, it, expect } from 'vitest';
import {
  SHORTCUTS,
  SHORTCUT_GROUPS,
  MARKDOWN_TYPING_RULES,
  shortcutById,
  formatShortcut,
  tiptapKey,
  ariaKeyShortcuts,
  withShortcut,
} from './shortcuts';

describe('shortcut map', () => {
  it('has unique ids and unique key combos', () => {
    const ids = SHORTCUTS.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    const combos = SHORTCUTS.map((s) => tiptapKey(s));
    expect(new Set(combos).size).toBe(combos.length);
  });

  it('never claims the global note search (Mod-K)', () => {
    expect(SHORTCUTS.map((s) => tiptapKey(s))).not.toContain('Mod-k');
  });

  it('uses only declared groups', () => {
    for (const s of SHORTCUTS) expect(SHORTCUT_GROUPS).toContain(s.group);
  });

  it('formats for macOS with symbols', () => {
    expect(formatShortcut(shortcutById('bold'), true)).toBe('⌘B');
    expect(formatShortcut(shortcutById('strike'), true)).toBe('⇧⌘X');
    expect(formatShortcut(shortcutById('heading1'), true)).toBe('⌥⌘1');
    expect(formatShortcut(shortcutById('horizontalRule'), true)).toBe('⇧⌘-');
  });

  it('formats for Windows/Linux with Ctrl', () => {
    expect(formatShortcut(shortcutById('bold'), false)).toBe('Ctrl+B');
    expect(formatShortcut(shortcutById('strike'), false)).toBe('Ctrl+Shift+X');
    expect(formatShortcut(shortcutById('heading1'), false)).toBe('Ctrl+Alt+1');
    expect(formatShortcut(shortcutById('cheatSheet'), false)).toBe('Ctrl+/');
  });

  it('builds TipTap keys', () => {
    expect(tiptapKey(shortcutById('bold'))).toBe('Mod-b');
    expect(tiptapKey(shortcutById('highlight'))).toBe('Mod-Shift-h');
    expect(tiptapKey(shortcutById('codeBlock'))).toBe('Mod-Shift-e');
    expect(tiptapKey(shortcutById('paragraph'))).toBe('Mod-Alt-0');
  });

  it('builds aria-keyshortcuts', () => {
    expect(ariaKeyShortcuts(shortcutById('bold'), true)).toBe('Meta+B');
    expect(ariaKeyShortcuts(shortcutById('strike'), false)).toBe('Control+Shift+X');
  });

  it('appends the shortcut to a tooltip label', () => {
    expect(withShortcut('Bold', 'bold', true)).toBe('Bold · ⌘B');
    expect(withShortcut('Bold', 'bold', false)).toBe('Bold · Ctrl+B');
  });

  it('documents the markdown typing rules in Spanish', () => {
    expect(MARKDOWN_TYPING_RULES.length).toBeGreaterThanOrEqual(10);
    expect(MARKDOWN_TYPING_RULES.some((r) => r.typed.includes('[[nota]]'))).toBe(true);
  });
});
