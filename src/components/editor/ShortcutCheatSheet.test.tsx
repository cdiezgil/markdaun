import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';

import { ShortcutCheatSheet } from './ShortcutCheatSheet';
import { SHORTCUTS, SHORTCUT_GROUPS, MARKDOWN_TYPING_RULES } from '../../lib/editor/shortcuts';

describe('ShortcutCheatSheet', () => {
  it('renders nothing when closed', () => {
    render(<ShortcutCheatSheet open={false} onClose={vi.fn()} mac />);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('lists every shortcut from the map, grouped, in macOS notation', () => {
    render(<ShortcutCheatSheet open onClose={vi.fn()} mac />);
    const dialog = screen.getByRole('dialog', { name: 'Atajos de teclado' });
    for (const g of SHORTCUT_GROUPS) {
      expect(within(dialog).getByText(g)).toBeDefined();
    }
    for (const s of SHORTCUTS) {
      expect(within(dialog).getAllByText(s.label).length).toBeGreaterThan(0);
    }
    expect(within(dialog).getByText('⌘B')).toBeDefined();
    expect(within(dialog).getByText('⇧⌘X')).toBeDefined();
  });

  it('uses Ctrl notation off macOS', () => {
    render(<ShortcutCheatSheet open onClose={vi.fn()} mac={false} />);
    expect(screen.getByText('Ctrl+B')).toBeDefined();
    expect(screen.getByText('Ctrl+Shift+X')).toBeDefined();
  });

  it('includes the Markdown typing section', () => {
    render(<ShortcutCheatSheet open onClose={vi.fn()} mac />);
    expect(screen.getByText('Escritura Markdown')).toBeDefined();
    for (const r of MARKDOWN_TYPING_RULES) {
      expect(screen.getAllByText(r.result).length).toBeGreaterThan(0);
    }
  });

  it('closes with Escape', () => {
    const onClose = vi.fn();
    render(<ShortcutCheatSheet open onClose={onClose} mac />);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('closes with Mod-/', () => {
    const onClose = vi.fn();
    render(<ShortcutCheatSheet open onClose={onClose} mac={false} />);
    fireEvent.keyDown(window, { key: '/', ctrlKey: true });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('closes when clicking outside the panel but not inside', () => {
    const onClose = vi.fn();
    render(<ShortcutCheatSheet open onClose={onClose} mac />);
    fireEvent.click(screen.getByRole('dialog'));
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId('shortcut-cheatsheet-overlay'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe('ShortcutCheatSheet layering', () => {
  it('is a modal over an ink scrim, with an opaque surface above the sticky toolbar', () => {
    render(<ShortcutCheatSheet open onClose={vi.fn()} mac />);
    const overlay = screen.getByTestId('shortcut-cheatsheet-overlay');
    const dialog = screen.getByRole('dialog');
    expect(overlay.style.backgroundColor).toContain('var(--ink)');
    expect(Number(overlay.style.zIndex)).toBeGreaterThan(5);
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(dialog.style.background).toBe('var(--surface)');
    expect(dialog.style.opacity).toBe('1');
  });

  it('takes focus and keeps it on Tab', () => {
    render(<ShortcutCheatSheet open onClose={vi.fn()} mac />);
    const dialog = screen.getByRole('dialog');
    expect(document.activeElement).toBe(dialog);
    fireEvent.keyDown(dialog, { key: 'Tab' });
    expect(document.activeElement).toBe(dialog);
  });
});
