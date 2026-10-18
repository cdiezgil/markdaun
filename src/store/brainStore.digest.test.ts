import { describe, it, expect, vi, beforeEach } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { useBrainStore } from './brainStore';
import { useInboxStore } from './inboxStore';
import type { InboxItem } from '../lib/tauri';

const prepareAttachments = vi.fn();
vi.mock('../lib/attachments/prepare', () => ({
  prepareAttachments: (...a: unknown[]) => prepareAttachments(...a),
}));

const mockInvoke = vi.mocked(invoke);

const item = (name: string, kind: InboxItem['kind']): InboxItem => ({
  name,
  path: `/v/Entrada/${name}`,
  rel_path: `Entrada/${name}`,
  kind,
  size: 1,
  added_ms: 1,
  supported: true,
});

const RESULT = (id: string) => ({ answer: 'ok', conversation_id: id, message_id: `m-${id}`, parts: 1 });

/** invoke router: digest -> RESULT(next id), conversations/messages -> canned. */
function route(results: Array<ReturnType<typeof RESULT> | Error>) {
  let i = 0;
  mockInvoke.mockImplementation(async (cmd: string) => {
    if (cmd === 'brain_digest') {
      const r = results[i++];
      if (r instanceof Error) throw r.message;
      return r;
    }
    if (cmd === 'brain_get_conversations') return [{ id: 'c1', title: 'Digerir: a.md', created_at: 'x', digest_source: 'Entrada/a.md', digest_archived: false }];
    if (cmd === 'brain_get_messages') return [{ id: 'm', role: 'assistant', content: 'ok', sources: null, created_at: 'x' }];
    if (cmd === 'inbox_list') return [];
    return undefined;
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  useInboxStore.setState({ items: [], selected: [], loading: false, error: null });
  useBrainStore.setState({
    conversations: [],
    currentConversationId: null,
    messages: [],
    isLoading: false,
    error: null,
    pendingAttachments: [],
    notices: [],
    pendingPrompt: null,
    digesting: null,
    digestProgress: null,
  });
});

describe('brainStore.digest', () => {
  it('passes the chosen area to the backend', async () => {
    route([RESULT('c1')]);
    await useBrainStore.getState().digest([item('a.md', 'md')], '/v', 'Mutua');
    expect(mockInvoke).toHaveBeenCalledWith('brain_digest', expect.objectContaining({ sourcePath: 'Entrada/a.md', area: 'Mutua' }));
  });

  it('digests a text source and opens the new conversation', async () => {
    route([RESULT('c1')]);
    await useBrainStore.getState().digest([item('a.md', 'md')], '/v');
    expect(mockInvoke).toHaveBeenCalledWith('brain_digest', {
      sourcePath: 'Entrada/a.md',
      vaultPath: '/v',
      attachments: null,
      sourceText: null,
      area: null,
    });
    const s = useBrainStore.getState();
    expect(s.currentConversationId).toBe('c1');
    expect(s.messages).toHaveLength(1);
    expect(s.conversations[0].digest_source).toBe('Entrada/a.md');
    expect(s.digesting).toBeNull();
    expect(s.isLoading).toBe(false);
    expect(s.error).toBeNull();
  });

  it('sends PDFs and images as attachments', async () => {
    route([RESULT('c1'), RESULT('c2')]);
    prepareAttachments.mockResolvedValue({ inputs: [{ vaultPath: 'Entrada/b.pdf', derived: { images: [], text: 'hola', pageCount: 3 } }], notices: [] });
    await useBrainStore.getState().digest([item('b.pdf', 'pdf')], '/v');
    expect(prepareAttachments).toHaveBeenCalledWith(
      [{ vaultPath: 'Entrada/b.pdf', absPath: '/v/Entrada/b.pdf', name: 'b.pdf', kind: 'pdf' }],
      expect.objectContaining({ nativePdf: expect.any(Boolean) }),
    );
    expect(mockInvoke).toHaveBeenCalledWith('brain_digest', {
      sourcePath: 'Entrada/b.pdf',
      vaultPath: '/v',
      attachments: [{ vaultPath: 'Entrada/b.pdf', derived: { images: [], text: 'hola', pageCount: 3 } }],
      sourceText: null,
      area: null,
    });
  });

  it('uses the extracted text of PDFs over the page limit', async () => {
    route([RESULT('c1')]);
    prepareAttachments.mockResolvedValue({
      inputs: [{ vaultPath: 'Entrada/big.pdf', derived: { images: [], text: 'texto largo', pageCount: 80 } }],
      notices: [],
    });
    await useBrainStore.getState().digest([item('big.pdf', 'pdf')], '/v');
    expect(mockInvoke).toHaveBeenCalledWith('brain_digest', {
      sourcePath: 'Entrada/big.pdf',
      vaultPath: '/v',
      attachments: null,
      sourceText: 'texto largo',
      area: null,
    });
  });

  it('runs several items one after another and stops at the first error', async () => {
    route([RESULT('c1'), new Error('llm_error: timed out'), RESULT('c3')]);
    await useBrainStore.getState().digest([item('a.md', 'md'), item('b.md', 'md'), item('c.md', 'md')], '/v');
    const digests = mockInvoke.mock.calls.filter((c) => c[0] === 'brain_digest');
    expect(digests).toHaveLength(2);
    expect(useBrainStore.getState().error).toContain('timed out');
    expect(useBrainStore.getState().digesting).toBeNull();
  });

  it('tracks part progress while digesting', async () => {
    let emit: (p: unknown) => void = () => {};
    vi.mocked(listen).mockImplementationOnce(async (_n, handler) => {
      emit = (payload) => (handler as (e: { payload: unknown }) => void)({ payload });
      return () => {};
    });
    let finish: (v: unknown) => void = () => {};
    mockInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === 'brain_digest') return new Promise((res) => (finish = res));
      return cmd === 'brain_get_conversations' || cmd === 'brain_get_messages' ? [] : undefined;
    });
    const run = useBrainStore.getState().digest([item('g.md', 'md')], '/v');
    await vi.waitFor(() => expect(useBrainStore.getState().digesting).toBe('g.md'));
    emit({ source: 'Entrada/g.md', part: 2, total: 5, consolidating: false });
    expect(useBrainStore.getState().digestProgress).toEqual({ source: 'Entrada/g.md', part: 2, total: 5, consolidating: false });
    emit({ source: 'Otra/x.md', part: 1, total: 2, consolidating: false });
    expect(useBrainStore.getState().digestProgress?.source).toBe('Entrada/g.md');
    finish(RESULT('c1'));
    await run;
    expect(useBrainStore.getState().digestProgress).toBeNull();
  });
});
