import { describe, it, expect, beforeEach } from 'vitest';
import { applyTheme, readThemePreference, saveThemePreference, THEME_STORAGE_KEY } from './theme';

describe('theme preference', () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute('data-theme');
  });

  it('defaults to following the system', () => {
    expect(readThemePreference()).toBe('system');
  });

  it('round-trips a saved choice', () => {
    saveThemePreference('dark');
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('dark');
    expect(readThemePreference()).toBe('dark');
  });

  it('ignores unknown stored values', () => {
    localStorage.setItem(THEME_STORAGE_KEY, 'sepia');
    expect(readThemePreference()).toBe('system');
  });

  it('survives storage that throws', () => {
    const original = Storage.prototype.getItem;
    Storage.prototype.getItem = () => {
      throw new Error('blocked');
    };
    try {
      expect(readThemePreference()).toBe('system');
      expect(() => saveThemePreference('light')).not.toThrow();
    } finally {
      Storage.prototype.getItem = original;
    }
  });

  it('sets data-theme for light and dark, and removes it for system', () => {
    const root = document.documentElement;
    applyTheme('dark');
    expect(root.getAttribute('data-theme')).toBe('dark');
    applyTheme('light');
    expect(root.getAttribute('data-theme')).toBe('light');
    applyTheme('system');
    expect(root.hasAttribute('data-theme')).toBe(false);
  });
});
