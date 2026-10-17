import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { NameDialog } from './NameDialog';
import React from 'react';

beforeEach(() => {
  vi.clearAllMocks();
});

function renderDialog(overrides: Partial<React.ComponentProps<typeof NameDialog>> = {}) {
  const props = {
    open: true,
    title: 'Nueva nota',
    hint: 'Se añadirá la extensión .md automáticamente.',
    onSubmit: vi.fn().mockResolvedValue(undefined),
    onCancel: vi.fn(),
    ...overrides,
  };
  render(<NameDialog {...props} />);
  return props;
}

describe('NameDialog', () => {
  it('muestra título, hint e input cuando está abierto', () => {
    renderDialog();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText('Nueva nota')).toBeInTheDocument();
    expect(screen.getByText(/extensión \.md/i)).toBeInTheDocument();
    expect(screen.getByTestId('name-dialog-input')).toBeInTheDocument();
  });

  it('no renderiza nada cuando open es false', () => {
    render(<NameDialog open={false} title="Nueva nota" onSubmit={vi.fn()} onCancel={vi.fn()} />);
    expect(screen.queryByTestId('name-dialog-overlay')).toBeNull();
  });

  it('rechaza nombre vacío y muestra error sin llamar a onSubmit', async () => {
    const props = renderDialog();
    fireEvent.click(screen.getByTestId('name-dialog-submit'));
    expect(await screen.findByTestId('name-dialog-error')).toHaveTextContent(
      'El nombre es obligatorio.',
    );
    expect(props.onSubmit).not.toHaveBeenCalled();
  });

  it('rechaza nombre de solo espacios', async () => {
    const props = renderDialog();
    fireEvent.change(screen.getByTestId('name-dialog-input'), { target: { value: '   ' } });
    fireEvent.click(screen.getByTestId('name-dialog-submit'));
    expect(await screen.findByTestId('name-dialog-error')).toBeInTheDocument();
    expect(props.onSubmit).not.toHaveBeenCalled();
  });

  it('llama a onSubmit con el nombre recortado al enviar', async () => {
    const props = renderDialog();
    fireEvent.change(screen.getByTestId('name-dialog-input'), {
      target: { value: '  mi nota  ' },
    });
    fireEvent.click(screen.getByTestId('name-dialog-submit'));
    await waitFor(() => expect(props.onSubmit).toHaveBeenCalledWith('mi nota'));
    expect(screen.queryByTestId('name-dialog-error')).toBeNull();
  });

  it('envía con Enter (form submit)', async () => {
    const props = renderDialog();
    fireEvent.change(screen.getByTestId('name-dialog-input'), { target: { value: 'nota' } });
    fireEvent.submit(screen.getByRole('dialog'));
    await waitFor(() => expect(props.onSubmit).toHaveBeenCalledWith('nota'));
  });

  it('muestra error amigable cuando ya existe', async () => {
    const props = renderDialog({ onSubmit: vi.fn().mockRejectedValue('already_exists') });
    fireEvent.change(screen.getByTestId('name-dialog-input'), { target: { value: 'nota' } });
    fireEvent.click(screen.getByTestId('name-dialog-submit'));
    expect(await screen.findByTestId('name-dialog-error')).toHaveTextContent(
      'Ya existe una nota o carpeta con ese nombre.',
    );
  });

  it('muestra error amigable con nombre inválido del backend', async () => {
    renderDialog({ onSubmit: vi.fn().mockRejectedValue('invalid_name') });
    fireEvent.change(screen.getByTestId('name-dialog-input'), { target: { value: 'x' } });
    fireEvent.click(screen.getByTestId('name-dialog-submit'));
    expect(await screen.findByTestId('name-dialog-error')).toHaveTextContent('Nombre no válido.');
  });

  it('Cancelar llama a onCancel', () => {
    const props = renderDialog();
    fireEvent.click(screen.getByTestId('name-dialog-cancel'));
    expect(props.onCancel).toHaveBeenCalled();
  });

  it('Escape llama a onCancel', () => {
    const props = renderDialog();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(props.onCancel).toHaveBeenCalled();
  });
});
