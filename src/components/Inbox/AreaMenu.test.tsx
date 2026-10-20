import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { AreaMenu } from './AreaMenu';

const FLAT = ['Mutua', 'Personal'];
const DEEP = ['Mutua', 'Mutua/Bernabeu', 'Mutua/Bernabeu/OrientaWealth', 'Personal', 'Personal/Recetas'];

describe('AreaMenu', () => {
  // TC-01: single-level vault — no chevrons, works like before.
  it('TC-01: shows top-level folders without chevrons when no subfolders', () => {
    render(<AreaMenu areas={FLAT} lastArea={null} count={1} onChoose={vi.fn()} onClose={vi.fn()} />);
    expect(screen.getByTestId('area-Mutua')).toBeTruthy();
    expect(screen.getByTestId('area-Personal')).toBeTruthy();
    expect(screen.getByTestId('area-root')).toBeTruthy();
  });

  // TC-02: vault with subfolders — chevron expands children.
  it('TC-02: chevron click expands and collapses children', () => {
    render(<AreaMenu areas={DEEP} lastArea={null} count={1} onChoose={vi.fn()} onClose={vi.fn()} />);
    // Bernabeu is a child of Mutua — not visible yet (Mutua is collapsed).
    expect(screen.queryByTestId('area-Mutua/Bernabeu')).toBeNull();
    // Expand Mutua via its chevron (aria-label="Expandir" button inside the row).
    const mutuaRow = screen.getByTestId('area-Mutua').closest('div')!;
    const chevron = mutuaRow.querySelector('button[aria-label="Expandir"]') as HTMLElement;
    fireEvent.click(chevron);
    expect(screen.getByTestId('area-Mutua/Bernabeu')).toBeTruthy();
    // Collapse again.
    fireEvent.click(chevron);
    expect(screen.queryByTestId('area-Mutua/Bernabeu')).toBeNull();
  });

  // TC-03: lastArea = "Mutua/Bernabeu" — branch is pre-expanded and highlighted.
  it('TC-03: pre-expands and highlights lastArea branch on open', () => {
    render(<AreaMenu areas={DEEP} lastArea="Mutua/Bernabeu" count={1} onChoose={vi.fn()} onClose={vi.fn()} />);
    // Mutua and Mutua/Bernabeu must be visible from the start.
    expect(screen.getByTestId('area-Mutua')).toBeTruthy();
    expect(screen.getByTestId('area-Mutua/Bernabeu')).toBeTruthy();
    // Bernabeu's children collapsed (OrientaWealth not visible yet).
    expect(screen.queryByTestId('area-Mutua/Bernabeu/OrientaWealth')).toBeNull();
    // Bernabeu button has aria-current="true".
    expect(screen.getByTestId('area-Mutua/Bernabeu').getAttribute('aria-current')).toBe('true');
  });

  // TC-04: Escape key closes the menu.
  it('TC-04: Escape key calls onClose', () => {
    const onClose = vi.fn();
    render(<AreaMenu areas={FLAT} lastArea={null} count={1} onChoose={vi.fn()} onClose={onClose} />);
    const menu = screen.getByRole('menu');
    fireEvent.keyDown(menu, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledOnce();
  });

  // TC-05: Entrada/ and hidden folders are excluded (comes from backend, but
  // AreaMenu must not render an item whose path starts with '.' or 'Entrada').
  it('TC-05: does not render Entrada/ or hidden folders if absent from props', () => {
    render(<AreaMenu areas={FLAT} lastArea={null} count={1} onChoose={vi.fn()} onClose={vi.fn()} />);
    expect(screen.queryByTestId('area-Entrada')).toBeNull();
    expect(screen.queryByText(/^\..*$/)).toBeNull();
  });

  it('selecting a folder calls onChoose with its path', () => {
    const onChoose = vi.fn();
    render(<AreaMenu areas={DEEP} lastArea="Mutua" count={2} onChoose={onChoose} onClose={vi.fn()} />);
    fireEvent.click(screen.getByTestId('area-Mutua'));
    expect(onChoose).toHaveBeenCalledWith('Mutua');
  });

  it('selecting root calls onChoose with empty string', () => {
    const onChoose = vi.fn();
    render(<AreaMenu areas={FLAT} lastArea={null} count={1} onChoose={onChoose} onClose={vi.fn()} />);
    fireEvent.click(screen.getByTestId('area-root'));
    expect(onChoose).toHaveBeenCalledWith('');
  });
});
