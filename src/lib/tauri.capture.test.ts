import { describe, it, expect, vi, beforeEach } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import {
  onInboxCaptured,
  onQuickCaptureOpen,
  onRequestQuit,
  quickCaptureGetConfig,
  quickCaptureHide,
  quickCaptureSave,
  quickCaptureSetShortcut,
  quitApp,
} from './tauri';

const mockInvoke = vi.mocked(invoke);
const mockListen = vi.mocked(listen);
beforeEach(() => {
  vi.clearAllMocks();
});

describe('quick capture wrappers', () => {
  it('send camelCase args', async () => {
    mockInvoke.mockResolvedValue(undefined as never);
    await quickCaptureSave('hola', 'aGk=');
    await quickCaptureSave('solo texto');
    await quickCaptureHide();
    await quickCaptureGetConfig();
    await quickCaptureSetShortcut('Alt+Cmd+N');
    await quitApp();
    expect(mockInvoke.mock.calls).toEqual([
      ['quick_capture_save', { text: 'hola', imageB64: 'aGk=' }],
      ['quick_capture_save', { text: 'solo texto', imageB64: null }],
      ['quick_capture_hide'],
      ['quick_capture_get_config'],
      ['quick_capture_set_shortcut', { shortcut: 'Alt+Cmd+N' }],
      ['quit_app'],
    ]);
  });
});

describe('event subscriptions', () => {
  it('listen to the backend event names and unwrap the payload', async () => {
    const cb = vi.fn();
    mockListen.mockImplementation((async (_name: string, handler: (e: { payload: unknown }) => void) => {
      handler({ payload: { kind: 'note' } });
      return () => {};
    }) as never);
    await onInboxCaptured(cb);
    expect(mockListen.mock.calls[0][0]).toBe('inbox-captured');
    expect(cb).toHaveBeenCalledWith({ kind: 'note' });
    await onRequestQuit(cb);
    await onQuickCaptureOpen(cb);
    expect(mockListen.mock.calls.map((c) => c[0])).toEqual(['inbox-captured', 'request-quit', 'quick-capture-open']);
  });
});
