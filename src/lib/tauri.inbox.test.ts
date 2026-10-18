import { describe, it, expect, vi, beforeEach } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import {
  archiveSource,
  brainDigest,
  inboxDiscard,
  inboxClipUrl,
  inboxEnsure,
  inboxList,
  onDigestProgress,
  trashDelete,
  trashList,
  trashRestore,
} from './tauri';

const mockInvoke = vi.mocked(invoke);
beforeEach(() => {
  vi.clearAllMocks();
});

describe('inbox wrappers', () => {
  it('send camelCase args', async () => {
    mockInvoke.mockResolvedValue([] as never);
    await inboxEnsure('/v');
    await inboxList('/v');
    await inboxDiscard('/v/Entrada/a.md', '/v');
    await trashList('/v');
    await trashRestore('17', '/v');
    await trashDelete('17', '/v');
    expect(mockInvoke.mock.calls).toEqual([
      ['inbox_ensure', { vaultPath: '/v' }],
      ['inbox_list', { vaultPath: '/v' }],
      ['inbox_discard', { path: '/v/Entrada/a.md', vaultPath: '/v' }],
      ['trash_list', { vaultPath: '/v' }],
      ['trash_restore', { id: '17', vaultPath: '/v' }],
      ['trash_delete', { id: '17', vaultPath: '/v' }],
    ]);
  });

  it('archiveSource passes the target folder and conversation', async () => {
    mockInvoke.mockResolvedValue({ path: '/v/P/Fuentes/a.md', rewritten: [] } as never);
    await archiveSource('/v/Entrada/a.md', 'P', '/v', 'c1');
    expect(mockInvoke).toHaveBeenCalledWith('archive_source', {
      path: '/v/Entrada/a.md',
      targetFolder: 'P',
      vaultPath: '/v',
      conversationId: 'c1',
    });
  });

  it('brainDigest sends the source and optional derived input', async () => {
    mockInvoke.mockResolvedValue({ answer: 'x' } as never);
    await brainDigest('Entrada/a.txt', '/v');
    expect(mockInvoke).toHaveBeenCalledWith('brain_digest', {
      sourcePath: 'Entrada/a.txt',
      vaultPath: '/v',
      attachments: null,
      sourceText: null,
    });
    await brainDigest('Entrada/a.pdf', '/v', [{ vaultPath: 'Entrada/a.pdf' }], 'texto');
    expect(mockInvoke).toHaveBeenLastCalledWith('brain_digest', {
      sourcePath: 'Entrada/a.pdf',
      vaultPath: '/v',
      attachments: [{ vaultPath: 'Entrada/a.pdf' }],
      sourceText: 'texto',
    });
  });

  it('onDigestProgress listens to digest-progress', async () => {
    const cb = vi.fn();
    vi.mocked(listen).mockImplementationOnce(async (_name, handler) => {
      (handler as (e: { payload: unknown }) => void)({ payload: { source: 's', part: 1, total: 2, consolidating: false } });
      return () => {};
    });
    await onDigestProgress(cb);
    expect(listen).toHaveBeenCalledWith('digest-progress', expect.any(Function));
    expect(cb).toHaveBeenCalledWith({ source: 's', part: 1, total: 2, consolidating: false });
  });
});

describe('inboxClipUrl', () => {
  it('sends the url and the vault in camelCase', async () => {
    mockInvoke.mockResolvedValue({ clipped: true } as never);
    await inboxClipUrl('https://example.com/a', '/v');
    expect(mockInvoke).toHaveBeenCalledWith('inbox_clip_url', { url: 'https://example.com/a', vaultPath: '/v' });
  });
});
