/** Appearance: follow the OS (no data-theme) or force Técnico (light) / Marino (dark). */
export type ThemePreference = 'system' | 'light' | 'dark';

export const THEME_STORAGE_KEY = 'markdaun:theme';

const PREFERENCES: readonly ThemePreference[] = ['system', 'light', 'dark'];

/** The saved preference; 'system' when nothing (or something unreadable) is stored. */
export function readThemePreference(): ThemePreference {
  try {
    const stored = localStorage.getItem(THEME_STORAGE_KEY);
    return PREFERENCES.includes(stored as ThemePreference) ? (stored as ThemePreference) : 'system';
  } catch {
    return 'system';
  }
}

export function saveThemePreference(preference: ThemePreference): void {
  try {
    localStorage.setItem(THEME_STORAGE_KEY, preference);
  } catch {
    // Storage blocked: the choice still applies for this session.
  }
}

/** tokens.css reads data-theme on <html>; without it, prefers-color-scheme decides. */
export function applyTheme(preference: ThemePreference, root: HTMLElement = document.documentElement): void {
  if (preference === 'system') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', preference);
}
