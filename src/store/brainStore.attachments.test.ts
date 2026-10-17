import { describe, it, expect, vi, beforeEach } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import { useBrainStore } from './brainStore';
import { useLlmStore } from './llmStore';
import type { ChatAttachment } from '../lib/attachments/types';

const prepareAttachments = vi.fn();
vi.mock('../lib/attachments/prepare', () => ({
  prepareAttachments: (...a: unknown[]) => prepareAttachments(...a),
}));

const mockInvoke = vi.mocked(invoke);

const att = (name: string, kind: 'image' | 'pdf' = 'image'): ChatAttachment => ({
  vaultPath: `d/${name}`,
  absPath: `/v/d/${name}`,
  name,
  kind,
});

const RESULT = { answer: 'ok', sources: [], conversation_id: 'c1', message_id: 'm1' };

beforeEach(() => {
  vi.clearAllMocks();
  useBrainStore.setState({
    conversations: [],
    currentConversationId: null,
    messages: [],
    isLoading: false,
    error: null,
    pendingAttachments: [],
    notices: [],
    pendingPrompt: null,
  });
  useLlmStore.setState({
    connections: [
      {
        id: 'k',
        name: 'Claude',
        presetId: null,
        engine: 'cliClaude',
        baseUrl: null,
        auth: { type: 'none' },
        authHeader: 'bearer',
        extraHeaders: [],
        caCertPath: null,
        azureApiVersion: null,
        models: ['sonnet'],
        visionModels: ['sonnet'],
      },
    ],
    active: { connectionId: 'k', model: 'sonnet' },
  });
  prepareAttachments.mockResolvedValue({ inputs: [], notices: [] });
});

describe('pending attachments', () => {
  it('adds, dedupes by path, removes and clears', () => {
    const s = useBrainStore.getState();
    expect(s.addAttachment(att('a.png'))).toBe('added');
    expect(useBrainStore.getState().addAttachment(att('a.png'))).toBe('duplicate');
    expect(useBrainStore.getState().pendingAttachments).toHaveLength(1);
    useBrainStore.getState().removeAttachment('d/a.png');
    expect(useBrainStore.getState().pendingAttachments).toHaveLength(0);
    useBrainStore.getState().addAttachment(att('b.png'));
    useBrainStore.getState().clearAttachments();
    expect(useBrainStore.getState().pendingAttachments).toEqual([]);
  });

  it('refuses a sixth attachment', () => {
    for (let i = 0; i < 5; i++) useBrainStore.getState().addAttachment(att(`${i}.png`));
    expect(useBrainStore.getState().addAttachment(att('6.png'))).toBe('limit');
    expect(useBrainStore.getState().pendingAttachments).toHaveLength(5);
  });

  it('askWithAttachments replaces the queue and records a one-shot prompt', () => {
    useBrainStore.getState().addAttachment(att('old.png'));
    useBrainStore.getState().askWithAttachments([att('new.png')], { text: 'hola', send: false });
    const s = useBrainStore.getState();
    expect(s.pendingAttachments.map((a) => a.name)).toEqual(['new.png']);
    expect(s.pendingPrompt).toMatchObject({ text: 'hola', send: false });
    expect(s.currentConversationId).toBeNull();
    expect(s.notices).toEqual([]);
    useBrainStore.getState().consumePendingPrompt();
    expect(useBrainStore.getState().pendingPrompt).toBeNull();
  });
});

describe('askWithAttachments notices', () => {
  it('keeps the notices handed over by the caller', () => {
    useBrainStore.getState().askWithAttachments([att('a.png')], { text: 'x', send: false }, ['n1']);
    expect(useBrainStore.getState().notices).toEqual(['n1']);
  });
});

describe('query with attachments', () => {
  it('prepares them for the active engine, sends them once and clears the queue', async () => {
    prepareAttachments.mockResolvedValue({
      inputs: [{ vaultPath: 'd/a.png' }],
      notices: ['aviso'],
    });
    mockInvoke.mockResolvedValueOnce(RESULT).mockResolvedValueOnce([]);
    useBrainStore.getState().addAttachment(att('a.png'));

    await useBrainStore.getState().query('¿qué ves?', '/v');

    expect(prepareAttachments).toHaveBeenCalledWith([att('a.png')], { nativePdf: true });
    expect(mockInvoke).toHaveBeenCalledWith('brain_query', {
      question: '¿qué ves?',
      vaultPath: '/v',
      conversationId: null,
      attachments: [{ vaultPath: 'd/a.png' }],
    });
    const s = useBrainStore.getState();
    expect(s.pendingAttachments).toEqual([]);
    expect(s.notices).toEqual(['aviso']);
    expect(s.messages[0].content).toBe('¿qué ves?\n\n📎 a.png');
  });

  it('non-native engines prepare PDFs with page images', async () => {
    useLlmStore.setState({
      connections: [
        { ...useLlmStore.getState().connections[0], engine: 'openAiCompat', models: ['gpt-4o'], visionModels: ['gpt-4o'] },
      ],
      active: { connectionId: 'k', model: 'gpt-4o' },
    });
    mockInvoke.mockResolvedValueOnce(RESULT).mockResolvedValueOnce([]);
    useBrainStore.getState().addAttachment(att('f.pdf', 'pdf'));
    await useBrainStore.getState().query('q', '/v');
    expect(prepareAttachments).toHaveBeenCalledWith(expect.anything(), { nativePdf: false });
  });

  it('keeps the attachments queued when sending fails', async () => {
    mockInvoke.mockRejectedValueOnce('vision_unsupported');
    useBrainStore.getState().addAttachment(att('a.png'));
    await useBrainStore.getState().query('q', '/v');
    const s = useBrainStore.getState();
    expect(s.error).toBe('vision_unsupported');
    expect(s.pendingAttachments).toHaveLength(1);
  });

  it('a preparation failure is reported and nothing is sent', async () => {
    prepareAttachments.mockRejectedValueOnce(new Error('No se pudo leer «a.png».'));
    useBrainStore.getState().addAttachment(att('a.png'));
    await useBrainStore.getState().query('q', '/v');
    expect(mockInvoke).not.toHaveBeenCalledWith('brain_query', expect.anything());
    expect(useBrainStore.getState().error).toContain('a.png');
    expect(useBrainStore.getState().pendingAttachments).toHaveLength(1);
  });

  it('text-only queries keep sending attachments: null', async () => {
    mockInvoke.mockResolvedValueOnce(RESULT).mockResolvedValueOnce([]);
    await useBrainStore.getState().query('hola', '/v');
    expect(mockInvoke).toHaveBeenCalledWith('brain_query', {
      question: 'hola',
      vaultPath: '/v',
      conversationId: null,
      attachments: null,
    });
    expect(prepareAttachments).not.toHaveBeenCalled();
  });
});
