import { describe, it, expect, vi, beforeEach } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import { useBrainStore } from './brainStore';
import { useEditorStore } from './editorStore';
import { useVaultStore } from './vaultStore';

const mockInvoke = vi.mocked(invoke);

const conv = { id: 'c1', title: 'Digerir: a.md', created_at: 'x', digest_source: 'Entrada/a.md', digest_archived: false };

beforeEach(() => {
  vi.clearAllMocks();
  useBrainStore.setState({ conversations: [conv], currentConversationId: 'c1', error: null, archiving: false });
  useVaultStore.setState({ vaultPath: '/v', tree: [] });
});

describe('brainStore.archiveDigestSource', () => {
  it('moves the source, relocates open notes and refreshes the conversation', async () => {
    const applyRelocation = vi.fn().mockResolvedValue(undefined);
    useEditorStore.setState({ applyRelocation });
    mockInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === 'archive_source') return { path: '/v/Mutua/Fuentes/a.md', rewritten: ['/v/n.md'] };
      if (cmd === 'brain_get_conversations') return [{ ...conv, digest_source: 'Mutua/Fuentes/a.md', digest_archived: true }];
      return [];
    });
    await useBrainStore.getState().archiveDigestSource('c1', '/v', 'Mutua');
    expect(mockInvoke).toHaveBeenCalledWith('archive_source', {
      path: '/v/Entrada/a.md',
      targetFolder: 'Mutua',
      vaultPath: '/v',
      conversationId: 'c1',
    });
    expect(applyRelocation).toHaveBeenCalledWith('/v/Entrada/a.md', '/v/Mutua/Fuentes/a.md', ['/v/n.md']);
    const c = useBrainStore.getState().conversations[0];
    expect(c.digest_archived).toBe(true);
    expect(c.digest_source).toBe('Mutua/Fuentes/a.md');
    expect(useBrainStore.getState().archiving).toBe(false);
  });

  it('keeps the error and stays unarchived when the move fails', async () => {
    mockInvoke.mockRejectedValue('already_exists' as never);
    await useBrainStore.getState().archiveDigestSource('c1', '/v', 'Mutua');
    expect(useBrainStore.getState().error).toContain('already_exists');
    expect(useBrainStore.getState().conversations[0].digest_archived).toBe(false);
    expect(useBrainStore.getState().archiving).toBe(false);
  });

  it('ignores conversations that are not digestions', async () => {
    useBrainStore.setState({ conversations: [{ id: 'c2', title: 'x', created_at: 'x' }] });
    await useBrainStore.getState().archiveDigestSource('c2', '/v', 'Mutua');
    expect(mockInvoke).not.toHaveBeenCalled();
  });
});
