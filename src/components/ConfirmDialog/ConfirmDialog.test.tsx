import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ConfirmDialog } from './ConfirmDialog';

const baseProps = {
  title: 'Eliminar archivo',
  message: '¿Seguro que quieres eliminar este archivo?',
  onConfirm: vi.fn(),
  onCancel: vi.fn(),
};

describe('TC-13, TC-14, TC-15: ConfirmDialog', () => {
  it('TC-14: no renderiza nada cuando open=false', () => {
    render(<ConfirmDialog {...baseProps} open={false} />);
    expect(screen.queryByTestId('confirm-dialog-overlay')).toBeNull();
  });

  it('TC-13: muestra overlay cuando open=true', () => {
    render(<ConfirmDialog {...baseProps} open={true} />);
    expect(screen.getByTestId('confirm-dialog-overlay')).toBeInTheDocument();
    expect(screen.getByText('Eliminar archivo')).toBeInTheDocument();
  });

  it('TC-13: clic en Eliminar llama onConfirm', async () => {
    const onConfirm = vi.fn();
    render(<ConfirmDialog {...baseProps} open={true} onConfirm={onConfirm} />);
    await userEvent.click(screen.getByTestId('confirm-dialog-delete'));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('TC-14: clic en Cancelar llama onCancel', async () => {
    const onCancel = vi.fn();
    render(<ConfirmDialog {...baseProps} open={true} onCancel={onCancel} />);
    await userEvent.click(screen.getByText('Cancelar'));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('TC-14: Escape llama onCancel', async () => {
    const onCancel = vi.fn();
    render(<ConfirmDialog {...baseProps} open={true} onCancel={onCancel} />);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('TC-15: el botón Eliminar no tiene backgroundColor rojo', () => {
    render(<ConfirmDialog {...baseProps} open={true} />);
    const btn = screen.getByTestId('confirm-dialog-delete');
    const bg = btn.style.backgroundColor;
    // debe ser var(--surface) — no rojo
    expect(bg).not.toMatch(/^#[Ff][0-4]/); // no empieza por rojo
    expect(bg).not.toBe('red');
    // color del texto debe ser var(--danger)
    expect(btn.style.color).toBe('var(--danger)');
    expect(btn.style.background).toBe('var(--surface)');
  });
});
