import { describe, it, expect, vi, beforeEach } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import { useInboxStore } from './inboxStore';
import type { InboxItem } from '../lib/tauri';

const mockInvoke = vi.mocked(invoke);

const audio: InboxItem = {
  name: 'Nota de voz.m4a',
  path: '/v/Entrada/Nota de voz.m4a',
  rel_path: 'Entrada/Nota de voz.m4a',
  kind: 'audio',
  size: 10,
  added_ms: 1,
  supported: false,
  voice: { state: 'error', detail: 'boom', progress: null },
};

beforeEach(() => {
  vi.clearAllMocks();
  useInboxStore.setState({ items: [audio], selected: [], error: null });
});

describe('inboxStore.retryVoice', () => {
  it('asks the backend to transcribe again and reloads the list', async () => {
    mockInvoke.mockImplementation(async (cmd: string) =>
      cmd === 'inbox_list' ? [{ ...audio, voice: { state: 'transcribing', detail: null, progress: null } }] : undefined,
    );
    await useInboxStore.getState().retryVoice(audio, '/v');
    expect(mockInvoke).toHaveBeenCalledWith('voice_retry', { vaultPath: '/v', relPath: 'Entrada/Nota de voz.m4a' });
    expect(useInboxStore.getState().items[0].voice?.state).toBe('transcribing');
  });

  it('keeps the error visible when the retry cannot start', async () => {
    mockInvoke.mockRejectedValueOnce('path_not_found');
    await useInboxStore.getState().retryVoice(audio, '/v');
    expect(useInboxStore.getState().error).toBe('path_not_found');
  });
});
