import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { invoke } from '@tauri-apps/api/core';
import { QuickCaptureSettings } from './QuickCaptureSettings';
import type { QuickConfig } from '../../lib/tauri';

const mockInvoke = vi.mocked(invoke);

const config = (over: Partial<QuickConfig> = {}): QuickConfig => ({
  shortcut: 'Ctrl+Alt+N',
  default_shortcut: 'Ctrl+Alt+N',
  error: null,
  ...over,
});

function backend(initial: QuickConfig, onSet?: (s: string) => QuickConfig | Promise<never>) {
  mockInvoke.mockImplementation((async (cmd: string, args?: { shortcut: string }) => {
    if (cmd === 'quick_capture_get_config') return initial;
    if (cmd === 'quick_capture_set_shortcut') return onSet ? onSet(args!.shortcut) : config({ shortcut: args!.shortcut });
    return undefined;
  }) as never);
}

const key = (code: string, mods: Record<string, boolean> = {}) =>
  fireEvent.keyDown(window, { code, ctrlKey: false, altKey: false, shiftKey: false, metaKey: false, ...mods });

beforeEach(() => {
  vi.clearAllMocks();
});

describe('QuickCaptureSettings', () => {
  it('shows the current shortcut', async () => {
    backend(config());
    render(<QuickCaptureSettings />);
    expect(await screen.findByTestId('shortcut-value')).toHaveTextContent('Ctrl+Alt+N');
    expect(screen.getByRole('heading', { name: 'Captura rápida' })).toBeInTheDocument();
  });

  it('records a new combination and saves it', async () => {
    backend(config());
    render(<QuickCaptureSettings />);
    fireEvent.click(await screen.findByRole('button', { name: 'Cambiar' }));
    expect(screen.getByTestId('shortcut-value')).toHaveTextContent('Pulsa la combinación…');
    key('KeyK', { ctrlKey: true, shiftKey: true });
    await waitFor(() =>
      expect(mockInvoke).toHaveBeenCalledWith('quick_capture_set_shortcut', { shortcut: 'Ctrl+Shift+K' }),
    );
    await waitFor(() => expect(screen.getByTestId('shortcut-value')).toHaveTextContent('Ctrl+Shift+K'));
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('Esc cancels the recording without changing anything', async () => {
    backend(config());
    render(<QuickCaptureSettings />);
    fireEvent.click(await screen.findByRole('button', { name: 'Cambiar' }));
    key('Escape');
    expect(screen.getByTestId('shortcut-value')).toHaveTextContent('Ctrl+Alt+N');
    expect(mockInvoke).not.toHaveBeenCalledWith('quick_capture_set_shortcut', expect.anything());
  });

  it('asks for a modifier when the combination has none', async () => {
    backend(config());
    render(<QuickCaptureSettings />);
    fireEvent.click(await screen.findByRole('button', { name: 'Cambiar' }));
    key('KeyN');
    expect(await screen.findByRole('alert')).toHaveTextContent('Ctrl, Alt o Cmd');
    expect(mockInvoke).not.toHaveBeenCalledWith('quick_capture_set_shortcut', expect.anything());
  });

  it('shows why a shortcut could not be registered and keeps the previous one', async () => {
    backend(config(), () => Promise.reject('shortcut_unavailable: HotKey already registered'));
    render(<QuickCaptureSettings />);
    fireEvent.click(await screen.findByRole('button', { name: 'Cambiar' }));
    key('KeyQ', { altKey: true, shiftKey: true });
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('otra aplicación');
    expect(alert).toHaveTextContent('HotKey already registered');
    expect(screen.getByTestId('shortcut-value')).toHaveTextContent('Ctrl+Alt+N');
  });

  it('surfaces a startup registration failure', async () => {
    backend(config({ error: 'HotKey already registered: Ctrl+Alt+N' }));
    render(<QuickCaptureSettings />);
    expect(await screen.findByRole('alert')).toHaveTextContent('El atajo no está activo');
    expect(screen.getByRole('alert')).toHaveTextContent('HotKey already registered');
  });

  it('restores the default shortcut', async () => {
    backend(config({ shortcut: 'Ctrl+Shift+K' }));
    render(<QuickCaptureSettings />);
    fireEvent.click(await screen.findByRole('button', { name: 'Restablecer' }));
    await waitFor(() =>
      expect(mockInvoke).toHaveBeenCalledWith('quick_capture_set_shortcut', { shortcut: 'Ctrl+Alt+N' }),
    );
  });

  it('hides Restablecer when the default is already set', async () => {
    backend(config());
    render(<QuickCaptureSettings />);
    await screen.findByTestId('shortcut-value');
    expect(screen.queryByRole('button', { name: 'Restablecer' })).toBeNull();
  });
});
