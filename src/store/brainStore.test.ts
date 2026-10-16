import { describe, it, expect, vi, beforeEach } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import { useBrainStore } from './brainStore';

const mockInvoke = vi.mocked(invoke);

const DEFAULT_CONFIG = { endpoint_url: 'https://api.openai.com/v1/chat/completions', model: 'gpt-4o-mini' };
const MOCK_CONVS = [
  { id: 'conv-1', title: 'Notas de viaje', created_at: '2024-01-02T00:00:00Z' },
  { id: 'conv-2', title: 'Ideas Python', created_at: '2024-01-01T00:00:00Z' },
];
const MOCK_MSGS = [
  { id: 'msg-1', role: 'user', content: '¿qué dice la nota?', sources: null, created_at: '2024-01-01T00:00:00Z' },
  { id: 'msg-2', role: 'assistant', content: 'Según tus notas...', sources: ['/vault/nota.md'], created_at: '2024-01-01T00:00:01Z' },
];

beforeEach(() => {
  vi.clearAllMocks();
  useBrainStore.setState({
    isConfigured: false,
    config: { endpoint_url: null, model: null },
    conversations: [],
    currentConversationId: null,
    messages: [],
    filterQuery: '',
    isLoading: false,
    error: null,
  });
});

// ── TC-18: configure invokes brain_configure ───────────────────────────────────

describe('TC-18: configure', () => {
  it('TC-18: invokes brain_configure and sets isConfigured', async () => {
    mockInvoke.mockResolvedValueOnce(undefined); // brain_configure

    await useBrainStore.getState().configure('https://api.openai.com/v1/chat/completions', 'sk-key', 'gpt-4o-mini');

    expect(mockInvoke).toHaveBeenCalledWith('brain_configure', expect.objectContaining({
      endpoint_url: 'https://api.openai.com/v1/chat/completions',
      api_key: 'sk-key',
      model: 'gpt-4o-mini',
    }));
    expect(useBrainStore.getState().isConfigured).toBe(true);
  });
});

// ── TC-19: query appends user + assistant messages ─────────────────────────────

describe('TC-19: query appends messages', () => {
  it('TC-19: after query, messages has user + assistant entries', async () => {
    mockInvoke
      .mockResolvedValueOnce({ // brain_query
        answer: 'Según tus notas...',
        sources: ['/vault/nota.md'],
        conversation_id: 'conv-new',
        message_id: 'msg-asst',
      })
      .mockResolvedValueOnce(MOCK_CONVS); // brain_get_conversations (reload)

    await useBrainStore.getState().query('¿qué dice?', '/vault');

    const { messages } = useBrainStore.getState();
    expect(messages.length).toBeGreaterThanOrEqual(2);
    const roles = messages.map((m) => m.role);
    expect(roles).toContain('user');
    expect(roles).toContain('assistant');
  });
});

// ── TC-20: isLoading is true during query ─────────────────────────────────────

describe('TC-20: isLoading during query', () => {
  it('TC-20: isLoading is set while query is pending', async () => {
    let resolveQuery!: (v: unknown) => void;
    mockInvoke.mockReturnValue(new Promise((res) => { resolveQuery = res; }) as never);

    const queryPromise = useBrainStore.getState().query('pregunta', '/vault');
    expect(useBrainStore.getState().isLoading).toBe(true);

    resolveQuery({
      answer: 'respuesta',
      sources: [],
      conversation_id: 'conv-1',
      message_id: 'msg-1',
    });
    await queryPromise;
    expect(useBrainStore.getState().isLoading).toBe(false);
  });
});

// ── TC-21: loadConversations populates list ────────────────────────────────────

describe('TC-21: loadConversations', () => {
  it('TC-21: conversations list is populated after load', async () => {
    mockInvoke.mockResolvedValueOnce(MOCK_CONVS);

    await useBrainStore.getState().loadConversations('/vault');

    expect(useBrainStore.getState().conversations.length).toBe(2);
  });
});

// ── TC-22: deleteConversation removes it ──────────────────────────────────────

describe('TC-22: deleteConversation', () => {
  it('TC-22: conversation removed from list', async () => {
    useBrainStore.setState({ conversations: MOCK_CONVS });
    mockInvoke.mockResolvedValueOnce(undefined); // brain_delete_conversation

    await useBrainStore.getState().deleteConversation('conv-1');

    const { conversations } = useBrainStore.getState();
    expect(conversations.length).toBe(1);
    expect(conversations[0].id).toBe('conv-2');
  });
});

// ── TC-23: filteredConversations filters by title ─────────────────────────────

describe('TC-23: setFilterQuery', () => {
  it('TC-23: filteredConversations returns only matching conversations', () => {
    useBrainStore.setState({ conversations: MOCK_CONVS });

    useBrainStore.getState().setFilterQuery('python');

    const filtered = useBrainStore.getState().filteredConversations();
    expect(filtered.length).toBe(1);
    expect(filtered[0].title).toBe('Ideas Python');
  });
});

// ── TC-24: startNewConversation resets state ───────────────────────────────────

describe('TC-24: startNewConversation', () => {
  it('TC-24: clears currentConversationId and messages', async () => {
    useBrainStore.setState({
      currentConversationId: 'conv-1',
      messages: MOCK_MSGS as never,
    });

    useBrainStore.getState().startNewConversation();

    expect(useBrainStore.getState().currentConversationId).toBeNull();
    expect(useBrainStore.getState().messages).toHaveLength(0);
  });
});
