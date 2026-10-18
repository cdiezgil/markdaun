import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import React from 'react';
import { TopBar } from './TopBar';

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <TopBar />
    </MemoryRouter>,
  );
}

describe('TopBar', () => {
  it('is a 48px bar on the sunken surface with a bottom border', () => {
    renderAt('/');
    const bar = screen.getByRole('banner');
    expect(bar.style.height).toBe('48px');
    expect(bar.style.background).toBe('var(--surface-sunken)');
    expect(bar.style.borderBottom).toBe('1px solid var(--line)');
  });

  it('renders the logotype with an italic Daun', () => {
    renderAt('/');
    const logo = screen.getByTestId('logotype');
    expect(logo).toHaveTextContent('MarkDaun');
    expect(logo.querySelector('i')).toHaveTextContent('Daun');
    expect(logo.style.fontFamily).toBe('var(--font-display)');
    expect(logo.style.fontWeight).toBe('400');
  });

  it('has Notas / Grafo / Brain tabs linking to the existing routes', () => {
    renderAt('/');
    const nav = screen.getByRole('navigation', { name: 'Vistas' });
    expect(nav).toContainElement(screen.getByRole('link', { name: 'Notas' }));
    expect(screen.getByRole('link', { name: 'Notas' })).toHaveAttribute('href', '/');
    expect(screen.getByRole('link', { name: 'Grafo' })).toHaveAttribute('href', '/graph');
    expect(screen.getByRole('link', { name: 'Brain' })).toHaveAttribute('href', '/brain');
  });

  it.each([
    ['/', 'Notas'],
    ['/editor/%2Fv%2Fa.md', 'Notas'],
    ['/preview/x', 'Notas'],
    ['/graph', 'Grafo'],
    ['/brain', 'Brain'],
  ])('marks the right tab active at %s', (path, active) => {
    renderAt(path);
    for (const name of ['Notas', 'Grafo', 'Brain']) {
      const link = screen.getByRole('link', { name });
      if (name === active) {
        expect(link).toHaveAttribute('aria-current', 'page');
        expect(link.style.background).toBe('var(--bg)');
      } else {
        expect(link).not.toHaveAttribute('aria-current');
        expect(link.style.color).toBe('var(--ink-muted)');
      }
    }
  });

  it('has no active tab in settings', () => {
    renderAt('/settings');
    for (const name of ['Notas', 'Grafo', 'Brain']) {
      expect(screen.getByRole('link', { name })).not.toHaveAttribute('aria-current');
    }
  });

  it('hosts the note search field with the shortcut hint', () => {
    renderAt('/');
    const field = screen.getByTestId('search-field');
    expect(field).toHaveTextContent(/⌘K|Ctrl K/);
    expect(field.style.width).toBe('280px');
    expect(screen.getByRole('combobox')).toBeInTheDocument();
  });
});
