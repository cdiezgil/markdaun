import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { TableSizePicker, MAX_ROWS, MAX_COLS } from './TableSizePicker';

const anchorRect = { left: 100, bottom: 44 };

function renderPicker(overrides: Partial<React.ComponentProps<typeof TableSizePicker>> = {}) {
  const props = {
    anchorRect,
    onSelect: vi.fn(),
    onClose: vi.fn(),
    ...overrides,
  };
  render(<TableSizePicker {...props} />);
  return props;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('TableSizePicker', () => {
  it('renderiza la rejilla completa (MAX_ROWS × MAX_COLS) con etiqueta inicial 3 × 3', () => {
    renderPicker();
    expect(screen.getByTestId('table-size-picker')).toBeInTheDocument();
    expect(screen.getByTestId('table-size-cell-0-0')).toBeInTheDocument();
    expect(
      screen.getByTestId(`table-size-cell-${MAX_ROWS - 1}-${MAX_COLS - 1}`),
    ).toBeInTheDocument();
    expect(screen.getByTestId('table-size-label')).toHaveTextContent('3 × 3');
  });

  it('al pasar el ratón por una celda, la etiqueta muestra ese tamaño', () => {
    renderPicker();
    fireEvent.mouseEnter(screen.getByTestId('table-size-cell-4-6'));
    expect(screen.getByTestId('table-size-label')).toHaveTextContent('5 × 7');
  });

  it('al hacer click en una celda llama a onSelect con filas y columnas (1-based)', () => {
    const props = renderPicker();
    fireEvent.click(screen.getByTestId('table-size-cell-1-2'));
    expect(props.onSelect).toHaveBeenCalledWith(2, 3);
  });

  it('al salir de la rejilla, la selección vuelve a 3 × 3', () => {
    renderPicker();
    const grid = screen.getByTestId('table-size-cell-0-0').parentElement!;
    fireEvent.mouseEnter(screen.getByTestId('table-size-cell-6-9'));
    expect(screen.getByTestId('table-size-label')).toHaveTextContent('7 × 10');
    fireEvent.mouseLeave(grid);
    expect(screen.getByTestId('table-size-label')).toHaveTextContent('3 × 3');
  });

  it('click en el overlay cierra el picker', () => {
    const props = renderPicker();
    fireEvent.click(screen.getByTestId('table-size-picker-overlay'));
    expect(props.onClose).toHaveBeenCalled();
  });

  it('Escape cierra el picker', () => {
    const props = renderPicker();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(props.onClose).toHaveBeenCalled();
  });
});
