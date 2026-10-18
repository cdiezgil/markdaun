import { describe, it, expect, vi, beforeEach } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import {
  onVoiceChanged,
  onVoiceModelProgress,
  quickCaptureSaveAudio,
  voiceDownloadModel,
  voiceGetConfig,
  voiceRetry,
  voiceSetModel,
} from './tauri';

const mockInvoke = vi.mocked(invoke);
const mockListen = vi.mocked(listen);
beforeEach(() => {
  vi.clearAllMocks();
});

describe('voice wrappers', () => {
  it('send camelCase args', async () => {
    mockInvoke.mockResolvedValue(undefined as never);
    await quickCaptureSaveAudio('AAEC', 'audio/mp4');
    await voiceRetry('/v', 'Entrada/a.m4a');
    await voiceGetConfig();
    await voiceSetModel('small');
    await voiceDownloadModel('small');
    expect(mockInvoke.mock.calls).toEqual([
      ['quick_capture_save_audio', { audioB64: 'AAEC', mime: 'audio/mp4' }],
      ['voice_retry', { vaultPath: '/v', relPath: 'Entrada/a.m4a' }],
      ['voice_get_config'],
      ['voice_set_model', { model: 'small' }],
      ['voice_download_model', { model: 'small' }],
    ]);
  });

  it('listen to voice-changed and voice-model-progress', async () => {
    const unlisten = vi.fn();
    let changed: (() => void) | undefined;
    let progress: ((e: { payload: unknown }) => void) | undefined;
    mockListen.mockImplementation((async (name: string, cb: never) => {
      if (name === 'voice-changed') changed = cb;
      if (name === 'voice-model-progress') progress = cb;
      return unlisten;
    }) as never);
    const onChanged = vi.fn();
    const onProgress = vi.fn();
    await onVoiceChanged(onChanged);
    await onVoiceModelProgress(onProgress);
    changed?.();
    progress?.({ payload: { id: 'small', done: 5, total: 10 } });
    expect(onChanged).toHaveBeenCalled();
    expect(onProgress).toHaveBeenCalledWith({ id: 'small', done: 5, total: 10 });
  });
});
