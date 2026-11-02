import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { AppearanceSettings } from './AppearanceSettings';
import { THEME_STORAGE_KEY } from '../../lib/theme';

describe('AppearanceSettings', () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute('data-theme');
  });

  it('offers Sistema, Claro and Oscuro, with Sistema selected by default', () => {
    render(<AppearanceSettings />);
    const group = screen.getByRole('radiogroup', { name: 'Tema' });
    expect(group).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'Sistema' })).toBeChecked();
    expect(screen.getByRole('radio', { name: 'Claro' })).not.toBeChecked();
    expect(screen.getByRole('radio', { name: 'Oscuro' })).not.toBeChecked();
  });

  it('applies and persists the chosen theme', () => {
    render(<AppearanceSettings />);
    fireEvent.click(screen.getByRole('radio', { name: 'Oscuro' }));
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('dark');
    expect(screen.getByRole('radio', { name: 'Oscuro' })).toBeChecked();

    fireEvent.click(screen.getByRole('radio', { name: 'Sistema' }));
    expect(document.documentElement.hasAttribute('data-theme')).toBe(false);
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('system');
  });

  it('starts from the saved choice', () => {
    localStorage.setItem(THEME_STORAGE_KEY, 'light');
    render(<AppearanceSettings />);
    expect(screen.getByRole('radio', { name: 'Claro' })).toBeChecked();
  });
});
