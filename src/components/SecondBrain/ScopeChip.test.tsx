import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useVaultStore, type VaultEntry } from '../../store/vaultStore';
import { useEditorStore } from '../../store/editorStore';
import { ScopeChip } from './ScopeChip';
import type { QueryScope } from '../../lib/tauri';

const file = (path: string): VaultEntry => ({ name: path.split('/').pop()!, path, kind: 'file' as const, file_type: 'md' as const, children: undefined });
const tree: VaultEntry[] = [
  {
    name: 'Mutua', path: '/vault/Mutua', kind: 'folder' as const,
    children: [file('/vault/Mutua/Primera nota.md'), file('/vault/Mutua/Segunda.md')],
  },
  file('/vault/Raiz.md'),
  { name: 'img.png', path: '/vault/img.png', kind: 'file' as const, file_type: 'image' as const },
];

function setup(scope: QueryScope = { kind: 'vault' }) {
  const onChange = vi.fn();
  render(<ScopeChip scope={scope} onChange={onChange} vaultPath="/vault" />);
  return onChange;
}

beforeEach(() => {
  useVaultStore.setState({ vaultPath: '/vault', tree });
  useEditorStore.setState({ activeNotePath: '/vault/Mutua/Primera nota.md' });
});

describe('ScopeChip label', () => {
  it.each([
    [{ kind: 'vault' }, '@ Toda la bóveda'],
    [{ kind: 'notes', paths: ['Mutua/Primera nota.md'] }, '@ Esta nota · Primera nota'],
    [{ kind: 'folder', path: 'Mutua/X' }, '@ Carpeta · Mutua/X'],
    [{ kind: 'notes', paths: ['a.md', 'b.md', 'c.md'] }, '@ 3 notas'],
  ] as [QueryScope, string][])('shows %j as "%s"', (scope, label) => {
    setup(scope);
    expect(screen.getByTestId('scope-chip')).toHaveTextContent(label);
  });
});

describe('ScopeChip menu', () => {
  it('opens with the four options', async () => {
    setup();
    expect(screen.queryByTestId('scope-menu')).toBeNull();
    await userEvent.click(screen.getByTestId('scope-chip'));
    const menu = screen.getByTestId('scope-menu');
    for (const name of [/Toda la bóveda/, /Esta nota/, /Carpeta…/, /Notas…/]) {
      expect(within(menu).getByRole('menuitem', { name })).toBeInTheDocument();
    }
  });

  it('Toda la bóveda resets the scope and closes', async () => {
    const onChange = setup({ kind: 'folder', path: 'Mutua' });
    await userEvent.click(screen.getByTestId('scope-chip'));
    await userEvent.click(screen.getByRole('menuitem', { name: /Toda la bóveda/ }));
    expect(onChange).toHaveBeenCalledWith({ kind: 'vault' });
    expect(screen.queryByTestId('scope-menu')).toBeNull();
  });

  it('Esta nota scopes to the note open in the editor (vault-relative)', async () => {
    const onChange = setup();
    await userEvent.click(screen.getByTestId('scope-chip'));
    await userEvent.click(screen.getByRole('menuitem', { name: /Esta nota/ }));
    expect(onChange).toHaveBeenCalledWith({ kind: 'notes', paths: ['Mutua/Primera nota.md'] });
  });

  it('Esta nota is disabled when no note is open', async () => {
    useEditorStore.setState({ activeNotePath: null });
    const onChange = setup();
    await userEvent.click(screen.getByTestId('scope-chip'));
    const item = screen.getByRole('menuitem', { name: /Esta nota/ });
    expect(item).toBeDisabled();
    await userEvent.click(item);
    expect(onChange).not.toHaveBeenCalled();
  });

  it('Carpeta… lists the vault folders and picks one', async () => {
    const onChange = setup();
    await userEvent.click(screen.getByTestId('scope-chip'));
    await userEvent.click(screen.getByRole('menuitem', { name: /Carpeta…/ }));
    expect(screen.queryByRole('menuitem', { name: /Esta nota/ })).toBeNull();
    await userEvent.click(screen.getByRole('menuitem', { name: 'Mutua' }));
    expect(onChange).toHaveBeenCalledWith({ kind: 'folder', path: 'Mutua' });
    expect(screen.queryByTestId('scope-menu')).toBeNull();
  });

  it('Notas… supports search and multi-selection, only markdown notes', async () => {
    const onChange = setup();
    await userEvent.click(screen.getByTestId('scope-chip'));
    await userEvent.click(screen.getByRole('menuitem', { name: /Notas…/ }));
    expect(screen.queryByRole('checkbox', { name: /img\.png/ })).toBeNull();
    expect(screen.getAllByRole('checkbox')).toHaveLength(3);

    await userEvent.type(screen.getByRole('textbox', { name: 'Buscar notas' }), 'segun');
    expect(screen.getAllByRole('checkbox')).toHaveLength(1);
    await userEvent.click(screen.getByRole('checkbox', { name: /Segunda/ }));
    await userEvent.clear(screen.getByRole('textbox', { name: 'Buscar notas' }));
    await userEvent.click(screen.getByRole('checkbox', { name: /Raiz/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Aplicar' }));
    expect(onChange).toHaveBeenCalledWith({ kind: 'notes', paths: ['Mutua/Segunda.md', 'Raiz.md'] });
  });

  it('Aplicar is disabled until a note is selected, and Escape closes the menu', async () => {
    setup();
    await userEvent.click(screen.getByTestId('scope-chip'));
    await userEvent.click(screen.getByRole('menuitem', { name: /Notas…/ }));
    expect(screen.getByRole('button', { name: 'Aplicar' })).toBeDisabled();
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByTestId('scope-menu')).toBeNull();
  });
});
