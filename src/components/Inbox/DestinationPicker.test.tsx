import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { DestinationPicker } from './DestinationPicker';

const FOLDERS = ['Entrada', 'Proyectos', 'Proyectos/Sub', 'Personal'];

function renderPicker(
  onConfirm = vi.fn(),
  onClose = vi.fn(),
  folders = FOLDERS,
) {
  return render(
    <DestinationPicker folders={folders} onConfirm={onConfirm} onClose={onClose} />,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('DestinationPicker', () => {
  it('TC-15: renders vault root, Entrada, Proyectos and Personal', () => {
    renderPicker();
    expect(screen.getByTestId('destination-picker')).toBeInTheDocument();
    expect(screen.getByTestId('dest-root')).toBeInTheDocument();
    expect(screen.getByTestId('dest-Entrada')).toBeInTheDocument();
    expect(screen.getByTestId('dest-Proyectos')).toBeInTheDocument();
    expect(screen.getByTestId('dest-Personal')).toBeInTheDocument();
  });

  it('TC-16: "Importar aquí" is disabled until a folder is selected', () => {
    renderPicker();
    expect(screen.getByTestId('confirm-import')).toBeDisabled();
  });

  it('TC-17: selecting a folder and clicking "Importar aquí" calls onConfirm with the correct path', () => {
    const onConfirm = vi.fn();
    renderPicker(onConfirm);
    fireEvent.click(screen.getByTestId('dest-Proyectos'));
    expect(screen.getByTestId('confirm-import')).not.toBeDisabled();
    fireEvent.click(screen.getByTestId('confirm-import'));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onConfirm).toHaveBeenCalledWith('Proyectos');
  });

  it('TC-17b: selecting vault root calls onConfirm with empty string', () => {
    const onConfirm = vi.fn();
    renderPicker(onConfirm);
    fireEvent.click(screen.getByTestId('dest-root'));
    fireEvent.click(screen.getByTestId('confirm-import'));
    expect(onConfirm).toHaveBeenCalledWith('');
  });

  it('TC-18: clicking "Cancelar" calls onClose and NOT onConfirm', () => {
    const onConfirm = vi.fn();
    const onClose = vi.fn();
    renderPicker(onConfirm, onClose);
    fireEvent.click(screen.getByTestId('cancel-import'));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('TC-18b: pressing Escape calls onClose and NOT onConfirm', () => {
    const onConfirm = vi.fn();
    const onClose = vi.fn();
    renderPicker(onConfirm, onClose);
    fireEvent.keyDown(screen.getByTestId('destination-picker'), { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('shows the header text', () => {
    renderPicker();
    expect(screen.getByText('¿En qué carpeta importar?')).toBeInTheDocument();
  });

  it('shows "Bóveda (raíz)" as the first option', () => {
    renderPicker();
    expect(screen.getByText('Bóveda (raíz)')).toBeInTheDocument();
  });
});
