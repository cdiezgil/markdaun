import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { AreaMenu } from './AreaMenu';

function renderMenu(
  areas: string[],
  lastArea: string | null = null,
  onChoose = vi.fn(),
  onClose = vi.fn(),
) {
  return render(
    <AreaMenu areas={areas} lastArea={lastArea} count={1} onChoose={onChoose} onClose={onClose} />,
  );
}

describe('AreaMenu', () => {
  // TC-01: flat vault (one level) — no chevrons visible (children-less nodes).
  it('TC-01: flat vault shows folders without expand chevrons', () => {
    renderMenu(['Mutua', 'Personal']);
    expect(screen.getByTestId('area-Mutua')).toBeInTheDocument();
    expect(screen.getByTestId('area-Personal')).toBeInTheDocument();
    // No child nodes means chevrons are non-interactive (transparent/hidden).
    // Verify no sub-node of Mutua is visible at render time.
    expect(screen.queryByTestId('area-Mutua/Sub')).not.toBeInTheDocument();
  });

  // TC-02: vault with subcarpetas — chevron expands/collapses children.
  it('TC-02: chevron expands children on click', () => {
    renderMenu(['Mutua', 'Mutua/Bernabeu', 'Personal']);

    // Child not yet visible.
    expect(screen.queryByTestId('area-Mutua/Bernabeu')).not.toBeInTheDocument();

    // Click the chevron of Mutua to expand it.
    const chevron = screen.getByTestId('chevron-Mutua');
    fireEvent.click(chevron);

    // Child now visible.
    expect(screen.getByTestId('area-Mutua/Bernabeu')).toBeInTheDocument();

    // Click chevron again to collapse.
    fireEvent.click(chevron);
    expect(screen.queryByTestId('area-Mutua/Bernabeu')).not.toBeInTheDocument();
  });

  // TC-02 cont: clicking a folder name at any level selects it.
  it('TC-02: clicking a folder name calls onChoose with its path', () => {
    const onChoose = vi.fn();
    renderMenu(['Mutua', 'Mutua/Bernabeu'], null, onChoose);

    // Expand first.
    fireEvent.click(screen.getByTestId('chevron-Mutua'));
    fireEvent.click(screen.getByTestId('area-Mutua/Bernabeu'));
    expect(onChoose).toHaveBeenCalledWith('Mutua/Bernabeu');
  });

  // TC-03: lastArea deep -> its branch is expanded and node is highlighted.
  it('TC-03: lastArea branch is auto-expanded and highlighted on open', () => {
    renderMenu(['Mutua', 'Mutua/Bernabeu'], 'Mutua/Bernabeu');

    // Mutua/Bernabeu must be visible without any click (branch auto-expanded).
    expect(screen.getByTestId('area-Mutua/Bernabeu')).toBeInTheDocument();

    // The selected node carries aria-current="true".
    expect(screen.getByTestId('area-Mutua/Bernabeu')).toHaveAttribute('aria-current', 'true');
  });

  // TC-04: Escape closes the menu.
  it('TC-04: Escape key calls onClose', () => {
    const onClose = vi.fn();
    renderMenu(['Mutua'], null, vi.fn(), onClose);
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  // TC-05: "Boveda (raiz)" is always present.
  it('TC-05: vault root option is always present', () => {
    renderMenu([]);
    expect(screen.getByTestId('area-root')).toBeInTheDocument();
  });

  // TC-05: areas array controls what appears.
  it('TC-05: folders not in areas prop do not appear in the menu', () => {
    renderMenu(['Personal']);
    expect(screen.queryByTestId('area-Entrada')).not.toBeInTheDocument();
    expect(screen.queryByTestId('area-.git')).not.toBeInTheDocument();
  });
});
