import { describe, it, expect, vi, beforeEach } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import { useBrainStore } from './brainStore';

const mockInvoke = vi.mocked(invoke);

beforeEach(() => {
  vi.clearAllMocks();
  useBrainStore.setState({
    conversations: [
      { id: 'c1', title: 'a', created_at: '', scope: { kind: 'folder', path: 'Mutua' } },
      { id: 'c2', title: 'b', created_at: '' },
    ],
    currentConversationId: null,
    messages: [],
    scope: { kind: 'vault' },
    error: null,
  });
});

describe('brainStore scope', () => {
  it('defaults to the whole vault', () => {
    expect(useBrainStore.getState().scope).toEqual({ kind: 'vault' });
  });

  it('selecting a conversation loads its stored scope (vault when absent)', async () => {
    mockInvoke.mockResolvedValue([]);
    await useBrainStore.getState().selectConversation('c1');
    expect(useBrainStore.getState().scope).toEqual({ kind: 'folder', path: 'Mutua' });
    await useBrainStore.getState().selectConversation('c2');
    expect(useBrainStore.getState().scope).toEqual({ kind: 'vault' });
  });

  it('a new conversation resets the scope', () => {
    useBrainStore.setState({ scope: { kind: 'notes', paths: ['a.md'] }, currentConversationId: 'c1' });
    useBrainStore.getState().startNewConversation();
    expect(useBrainStore.getState().scope).toEqual({ kind: 'vault' });
  });

  it('setScope without a conversation only updates local state', async () => {
    await useBrainStore.getState().setScope({ kind: 'folder', path: 'M' }, '/v');
    expect(useBrainStore.getState().scope).toEqual({ kind: 'folder', path: 'M' });
    expect(mockInvoke).not.toHaveBeenCalled();
  });

  it('setScope on an open conversation persists it', async () => {
    mockInvoke.mockResolvedValue({ kind: 'vault' });
    useBrainStore.setState({ currentConversationId: 'c2' });
    await useBrainStore.getState().setScope({ kind: 'notes', paths: ['a.md'] }, '/v');
    expect(mockInvoke).toHaveBeenCalledWith('brain_set_conversation_scope', {
      conversationId: 'c2',
      vaultPath: '/v',
      scope: { kind: 'notes', paths: ['a.md'] },
    });
    expect(useBrainStore.getState().conversations.find((c) => c.id === 'c2')?.scope).toEqual({
      kind: 'notes',
      paths: ['a.md'],
    });
  });

  it('query sends the current scope and the user message is exactly what was typed', async () => {
    mockInvoke
      .mockResolvedValueOnce({ answer: 'ok', sources: [], conversation_id: 'n', message_id: 'm' })
      .mockResolvedValueOnce([]);
    useBrainStore.setState({ scope: { kind: 'notes', paths: ['a.md'] } });
    await useBrainStore.getState().query('¿qué dice?', '/v');
    expect(mockInvoke).toHaveBeenCalledWith(
      'brain_query',
      expect.objectContaining({ question: '¿qué dice?', scope: { kind: 'notes', paths: ['a.md'] } }),
    );
    expect(useBrainStore.getState().messages[0]?.content).toBe('¿qué dice?');
  });

  it('askAboutNote starts a fresh conversation scoped to that note', () => {
    useBrainStore.setState({ currentConversationId: 'c1' });
    useBrainStore.getState().askAboutNote('Test/a.md');
    const s = useBrainStore.getState();
    expect(s.currentConversationId).toBeNull();
    expect(s.scope).toEqual({ kind: 'notes', paths: ['Test/a.md'] });
  });
});
