import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { VoiceSettings } from './VoiceSettings';
import type { VoiceConfig } from '../../lib/tauri';

const mockInvoke = vi.mocked(invoke);
const mockListen = vi.mocked(listen);

const config = (over: Partial<VoiceConfig> = {}): VoiceConfig => ({
  model: 'large-v3-turbo',
  models: [
    { id: 'large-v3-turbo', label: 'Calidad máxima (large-v3-turbo)', approx_mb: 550, downloaded: false },
    { id: 'small', label: 'Ligero (small)', approx_mb: 190, downloaded: true },
  ],
  ...over,
});

let progress: ((e: { payload: unknown }) => void) | undefined;

beforeEach(() => {
  vi.clearAllMocks();
  progress = undefined;
  mockListen.mockImplementation((async (name: string, cb: (e: { payload: unknown }) => void) => {
    if (name === 'voice-model-progress') progress = cb;
    return () => {};
  }) as never);
});

describe('VoiceSettings', () => {
  it('lists the models with size and download state and marks the selected one', async () => {
    mockInvoke.mockResolvedValue(config());
    render(<VoiceSettings />);
    expect(await screen.findByRole('heading', { name: 'Notas de voz' })).toBeInTheDocument();
    const large = screen.getByRole('radio', { name: /calidad máxima/i });
    const small = screen.getByRole('radio', { name: /ligero/i });
    expect(large).toBeChecked();
    expect(small).not.toBeChecked();
    expect(screen.getByTestId('model-large-v3-turbo')).toHaveTextContent('550 MB');
    expect(screen.getByTestId('model-large-v3-turbo')).toHaveTextContent('Se descargará al usarlo');
    expect(screen.getByTestId('model-small')).toHaveTextContent('Descargado');
  });

  it('changing the model saves the choice', async () => {
    mockInvoke.mockImplementation((async (cmd: string) =>
      cmd === 'voice_set_model' ? config({ model: 'small' }) : config()) as never);
    render(<VoiceSettings />);
    fireEvent.click(await screen.findByRole('radio', { name: /ligero/i }));
    await waitFor(() => expect(mockInvoke).toHaveBeenCalledWith('voice_set_model', { model: 'small' }));
    await waitFor(() => expect(screen.getByRole('radio', { name: /ligero/i })).toBeChecked());
  });

  it('downloads a model ahead of time showing progress', async () => {
    let finish: (c: VoiceConfig) => void = () => {};
    mockInvoke.mockImplementation((async (cmd: string) => {
      if (cmd === 'voice_download_model') return new Promise<VoiceConfig>((r) => (finish = r));
      return config();
    }) as never);
    render(<VoiceSettings />);
    fireEvent.click(await screen.findByRole('button', { name: /descargar ahora/i }));
    await waitFor(() => expect(mockInvoke).toHaveBeenCalledWith('voice_download_model', { model: 'large-v3-turbo' }));
    act(() => progress?.({ payload: { id: 'large-v3-turbo', done: 55, total: 110 } }));
    expect(await screen.findByTestId('model-large-v3-turbo')).toHaveTextContent('50 %');
    await act(async () =>
      finish(config({ models: config().models.map((m) => ({ ...m, downloaded: true })) })),
    );
    await waitFor(() => expect(screen.getByTestId('model-large-v3-turbo')).toHaveTextContent('Descargado'));
  });

  it('reports a failed download', async () => {
    mockInvoke.mockImplementation((async (cmd: string) => {
      if (cmd === 'voice_download_model') throw 'download: HTTP 503';
      return config();
    }) as never);
    render(<VoiceSettings />);
    fireEvent.click(await screen.findByRole('button', { name: /descargar ahora/i }));
    expect(await screen.findByRole('alert')).toHaveTextContent('HTTP 503');
  });
});
