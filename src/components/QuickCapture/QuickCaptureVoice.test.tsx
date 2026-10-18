import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { QuickCaptureWindow } from './QuickCaptureWindow';
import { VoiceRecorder, MAX_RECORDING_MS } from '../../lib/voice/recorder';

vi.mock('../../lib/voice/recorder', async (orig) => ({
  ...(await orig<typeof import('../../lib/voice/recorder')>()),
  VoiceRecorder: { start: vi.fn() },
}));

const mockInvoke = vi.mocked(invoke);
const mockListen = vi.mocked(listen);
const mockStart = vi.mocked(VoiceRecorder.start);

let elapsed = 0;
let level = 0;
const fake = {
  elapsedMs: vi.fn(() => elapsed),
  level: vi.fn(() => level),
  stop: vi.fn(),
  cancel: vi.fn(),
};
let openHandler: (() => void) | undefined;

beforeEach(() => {
  vi.clearAllMocks();
  elapsed = 0;
  level = 0;
  openHandler = undefined;
  fake.stop.mockResolvedValue({ blob: new Blob(['abc'], { type: 'audio/mp4' }), mime: 'audio/mp4', durationMs: 5000 });
  mockStart.mockResolvedValue(fake as unknown as VoiceRecorder);
  mockInvoke.mockResolvedValue({ kind: 'voice', rel_path: 'Entrada/Nota de voz.m4a', clipped: null, failure: null } as never);
  mockListen.mockImplementation((async (name: string, cb: () => void) => {
    if (name === 'quick-capture-open') openHandler = cb;
    return () => {};
  }) as never);
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
});

afterEach(() => {
  vi.useRealTimers();
});

const mic = () => screen.getByRole('button', { name: /grabar nota de voz/i });
const textBox = () => screen.queryByPlaceholderText('Escribe, pega una URL o una imagen…');

async function startRecording() {
  render(<QuickCaptureWindow />);
  await act(async () => {
    fireEvent.click(mic());
  });
  await screen.findByTestId('recording-panel');
}

function tick(ms = 200) {
  act(() => {
    vi.advanceTimersByTime(ms);
  });
}

describe('QuickCaptureWindow — voice', () => {
  it('shows a microphone button next to the text capture', () => {
    render(<QuickCaptureWindow />);
    expect(mic()).toBeEnabled();
  });

  it('recording replaces the text box and shows elapsed time and a level meter', async () => {
    await startRecording();
    expect(textBox()).toBeNull();
    expect(screen.getByTestId('recording-time')).toHaveTextContent('0:00');
    elapsed = 3200;
    level = 0.5;
    tick();
    expect(screen.getByTestId('recording-time')).toHaveTextContent('0:03');
    expect(screen.getByRole('meter', { name: /nivel/i })).toHaveAttribute('aria-valuenow', '0.5');
  });

  it('the stop button saves the recording as base64 and starts over', async () => {
    await startRecording();
    elapsed = 5000;
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /detener y guardar/i }));
    });
    await waitFor(() => expect(mockInvoke).toHaveBeenCalledWith('quick_capture_save_audio', { audioB64: btoa('abc'), mime: 'audio/mp4' }));
    await waitFor(() => expect(screen.queryByTestId('recording-panel')).toBeNull());
    expect(textBox()).not.toBeNull();
  });

  it.each([
    ['Cmd', { metaKey: true }],
    ['Ctrl', { ctrlKey: true }],
  ])('%s+Enter stops and saves', async (_n, mods) => {
    await startRecording();
    elapsed = 5000;
    await act(async () => {
      fireEvent.keyDown(document, { key: 'Enter', ...mods });
    });
    await waitFor(() => expect(mockInvoke).toHaveBeenCalledWith('quick_capture_save_audio', expect.anything()));
  });

  it('Esc discards the recording and returns to the text box without closing the window', async () => {
    await startRecording();
    await act(async () => {
      fireEvent.keyDown(document, { key: 'Escape' });
    });
    expect(fake.cancel).toHaveBeenCalled();
    expect(screen.queryByTestId('recording-panel')).toBeNull();
    expect(textBox()).not.toBeNull();
    expect(mockInvoke).not.toHaveBeenCalledWith('quick_capture_save_audio', expect.anything());
    expect(mockInvoke).not.toHaveBeenCalledWith('quick_capture_hide');
  });

  it('stops and saves by itself at the thirty-minute limit', async () => {
    await startRecording();
    elapsed = MAX_RECORDING_MS;
    await act(async () => {
      vi.advanceTimersByTime(200);
    });
    await waitFor(() => expect(fake.stop).toHaveBeenCalled());
    await waitFor(() => expect(mockInvoke).toHaveBeenCalledWith('quick_capture_save_audio', expect.anything()));
  });

  it('a recording under a second is discarded with an explanation', async () => {
    fake.stop.mockResolvedValue({ blob: new Blob(['a']), mime: 'audio/mp4', durationMs: 300 });
    await startRecording();
    elapsed = 300;
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /detener y guardar/i }));
    });
    expect(await screen.findByRole('alert')).toHaveTextContent(/demasiado corta/i);
    expect(mockInvoke).not.toHaveBeenCalledWith('quick_capture_save_audio', expect.anything());
  });

  it('explains a denied microphone and stays in text mode', async () => {
    mockStart.mockRejectedValueOnce(Object.assign(new Error('no'), { name: 'NotAllowedError' }));
    render(<QuickCaptureWindow />);
    await act(async () => {
      fireEvent.click(mic());
    });
    expect(await screen.findByRole('alert')).toHaveTextContent(/permiso/i);
    expect(screen.queryByTestId('recording-panel')).toBeNull();
  });

  it('text and image capture are mutually exclusive with recording', async () => {
    render(<QuickCaptureWindow />);
    fireEvent.change(textBox() as HTMLElement, { target: { value: 'ya escribí algo' } });
    expect(mic()).toBeDisabled();
  });

  it('showing the window again discards a recording left running', async () => {
    await startRecording();
    await waitFor(() => expect(openHandler).toBeDefined());
    act(() => openHandler?.());
    expect(fake.cancel).toHaveBeenCalled();
    expect(screen.queryByTestId('recording-panel')).toBeNull();
  });

  it('closing the window while recording releases the microphone', async () => {
    const { unmount } = render(<QuickCaptureWindow />);
    await act(async () => {
      fireEvent.click(mic());
    });
    await screen.findByTestId('recording-panel');
    unmount();
    expect(fake.cancel).toHaveBeenCalled();
  });

  it('shows what went wrong when saving fails and lets the user record again', async () => {
    mockInvoke.mockRejectedValueOnce('no_vault');
    await startRecording();
    elapsed = 5000;
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /detener y guardar/i }));
    });
    expect(await screen.findByRole('alert')).toHaveTextContent('Abre una bóveda');
    expect(mic()).toBeEnabled();
  });
});
