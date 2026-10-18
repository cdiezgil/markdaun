import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom';
import React from 'react';
import { NoteSearch } from './NoteSearch';
import { useVaultStore, type VaultEntry } from '../../store/vaultStore';

const file = (name: string, path: string, file_type: VaultEntry['file_type'] = 'md'): VaultEntry => ({
  name, path, kind: 'file', file_type,
});

const TREE: VaultEntry[] = [
  file('Nóta uno.md', '/v/Nóta uno.md'),
  file('Plan.md', '/v/Proyectos/Plan.md'),
  file('foto.png', '/v/foto.png', 'image'),
  { name: 'Proyectos', path: '/v/Proyectos', kind: 'folder', children: [file('Plan.md', '/v/Proyectos/Plan.md')] },
];

function Where() {
  return <div data-testid="where">{useLocation().pathname}</div>;
}

function setup() {
  return render(
    <MemoryRouter initialEntries={['/']}>
      <NoteSearch />
      <textarea data-testid="outside" />
      <Routes>
        <Route path="*" element={<Where />} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  useVaultStore.setState({ vaultPath: '/v', tree: TREE, selectedFolder: null });
});

const input = () => screen.getByRole('combobox');
function type(value: string) {
  input().focus();
  fireEvent.change(input(), { target: { value } });
}

describe('NoteSearch', () => {
  it('renders a 280px field with the shortcut hint and no dropdown', () => {
    setup();
    expect(screen.getByTestId('search-field').style.width).toBe('280px');
    expect(input()).toHaveAttribute('placeholder', 'Buscar notas…');
    expect(screen.getByTestId('search-field')).toHaveTextContent(/⌘K|Ctrl K/);
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('focuses the field on Mod+K from anywhere, including text inputs', () => {
    setup();
    const outside = screen.getByTestId('outside');
    outside.focus();
    const ev = new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, bubbles: true, cancelable: true });
    outside.dispatchEvent(ev);
    expect(input()).toHaveFocus();
    expect(ev.defaultPrevented).toBe(true);
    outside.focus();
    fireEvent.keyDown(outside, { key: 'K', metaKey: true });
    expect(input()).toHaveFocus();
  });

  it('does not react to plain K or other Mod shortcuts', () => {
    setup();
    const outside = screen.getByTestId('outside');
    outside.focus();
    fireEvent.keyDown(outside, { key: 'k' });
    fireEvent.keyDown(outside, { key: 'b', ctrlKey: true });
    expect(outside).toHaveFocus();
  });

  it('shows nothing for an empty query', () => {
    setup();
    input().focus();
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('lists only .md notes matching diacritics-insensitively, with highlighted characters', () => {
    setup();
    type('nota');
    const options = screen.getAllByRole('option');
    expect(options).toHaveLength(1);
    expect(options[0]).toHaveTextContent('Nóta uno');
    const marks = options[0].querySelectorAll('mark');
    expect(Array.from(marks).map((m) => m.textContent).join('')).toBe('Nóta');
    expect(marks[0].style.background).toBe('var(--mark)');
  });

  it('deduplicates nothing but excludes non-markdown files', () => {
    setup();
    type('foto');
    expect(screen.getByText('Sin resultados')).toBeInTheDocument();
  });

  it('shows the folder under the title', () => {
    setup();
    type('plan');
    expect(within(screen.getAllByRole('option')[0]).getByText('Proyectos')).toBeInTheDocument();
  });

  it('moves the selection with arrows (wrapping) and opens the active note with Enter', () => {
    setup();
    type('n');
    const opts = () => screen.getAllByRole('option');
    expect(opts()[0]).toHaveAttribute('aria-selected', 'true');
    expect(input()).toHaveAttribute('aria-activedescendant', opts()[0].id);
    fireEvent.keyDown(input(), { key: 'ArrowUp' });
    const last = opts().length - 1;
    expect(opts()[last]).toHaveAttribute('aria-selected', 'true');
    fireEvent.keyDown(input(), { key: 'ArrowDown' });
    expect(opts()[0]).toHaveAttribute('aria-selected', 'true');
    fireEvent.keyDown(input(), { key: 'Enter' });
    expect(screen.getByTestId('where').textContent).toBe(
      `/editor/${encodeURIComponent("/v/Nóta uno.md")}`,
    );
  });

  it('opens a note on click, closes the dropdown and selects its folder', () => {
    setup();
    type('plan');
    fireEvent.mouseDown(screen.getAllByRole('option')[0]);
    expect(screen.getByTestId('where').textContent).toBe(
      `/editor/${encodeURIComponent('/v/Proyectos/Plan.md')}`,
    );
    expect(screen.queryByRole('listbox')).toBeNull();
    expect((input() as HTMLInputElement).value).toBe('');
    expect(useVaultStore.getState().selectedFolder).toBe('/v/Proyectos');
  });

  it('hover changes the active option', () => {
    setup();
    type('n');
    const opts = screen.getAllByRole('option');
    fireEvent.mouseEnter(opts[opts.length - 1]);
    expect(opts[opts.length - 1]).toHaveAttribute('aria-selected', 'true');
  });

  it('Esc clears the query and blurs', () => {
    setup();
    input().focus();
    type('plan');
    fireEvent.keyDown(input(), { key: 'Escape' });
    expect((input() as HTMLInputElement).value).toBe('');
    expect(input()).not.toHaveFocus();
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('closes the dropdown on blur', () => {
    setup();
    input().focus();
    type('plan');
    fireEvent.blur(input());
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('caps the list at 20 results', () => {
    useVaultStore.setState({
      tree: Array.from({ length: 30 }, (_, i) => file(`n${i}.md`, `/v/n${i}.md`)),
    });
    setup();
    type('n');
    expect(screen.getAllByRole('option')).toHaveLength(20);
  });

  it('Enter with no results does nothing', () => {
    setup();
    type('zzzz');
    fireEvent.keyDown(input(), { key: 'Enter' });
    expect(screen.getByTestId('where').textContent).toBe('/');
  });
});
