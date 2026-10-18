import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { invoke } from '@tauri-apps/api/core';
import { useBrainStore } from '../../store/brainStore';
import { ChatPanel } from './ChatPanel';
import React from 'react';

vi.mocked(invoke);
const realQuery = useBrainStore.getState().query;

beforeEach(() => {
  vi.clearAllMocks();
  useBrainStore.setState({
    conversations: [],
    currentConversationId: null,
    messages: [],
    filterQuery: '',
    isLoading: false,
    error: null,
  });
});

function renderChatPanel() {
  return render(
    <MemoryRouter>
      <ChatPanel vaultPath="/vault" />
    </MemoryRouter>,
  );
}

// ── TC-33: spinner visible when isLoading ─────────────────────────────────────

describe('TC-33: ChatPanel spinner', () => {
  it('TC-33: chat-spinner is visible when isLoading is true', () => {
    useBrainStore.setState({ isLoading: true });
    renderChatPanel();
    expect(screen.getByTestId('chat-spinner')).toBeInTheDocument();
  });
});

// ── TC-34: input disabled when isLoading ─────────────────────────────────────

describe('TC-34: ChatPanel input disabled', () => {
  it('TC-34: chat-input is disabled when isLoading is true', () => {
    useBrainStore.setState({ isLoading: true });
    renderChatPanel();
    expect(screen.getByTestId('chat-input')).toBeDisabled();
  });
});

// ── TC-35b: spinner not shown when not loading ────────────────────────────────

describe('TC-35b: ChatPanel no spinner when idle', () => {
  it('TC-35b: no spinner when isLoading is false', () => {
    useBrainStore.setState({ isLoading: false });
    renderChatPanel();
    expect(screen.queryByTestId('chat-spinner')).not.toBeInTheDocument();
  });
});

// ── Errors are visible ────────────────────────────────────────────────────────

describe('ChatPanel error display', () => {
  it('renders a human message for the store error with the danger token', () => {
    useBrainStore.setState({ error: 'llm_error: credentials rejected' });
    renderChatPanel();
    const el = screen.getByTestId('chat-error');
    expect(el).toHaveTextContent(/credenciales/i);
    expect(el.style.color).toBe('var(--danger)');
  });

  it('maps not_configured', () => {
    useBrainStore.setState({ error: 'not_configured' });
    renderChatPanel();
    expect(screen.getByTestId('chat-error')).toHaveTextContent(/conexión/i);
  });

  it('shows no error element when there is no error', () => {
    renderChatPanel();
    expect(screen.queryByTestId('chat-error')).not.toBeInTheDocument();
  });

  it('keeps a failed user message visible', () => {
    useBrainStore.setState({
      error: 'not_configured',
      messages: [
        { id: 'u1', role: 'user', content: 'sigo aquí', sources: null, created_at: 'x', failed: true },
      ],
    });
    renderChatPanel();
    expect(screen.getByText('sigo aquí')).toBeInTheDocument();
  });
});

// ── Attachments ───────────────────────────────────────────────────────────────

import userEvent from '@testing-library/user-event';
import { fireEvent } from '@testing-library/react';
import { useLlmStore } from '../../store/llmStore';
import { useVaultStore } from '../../store/vaultStore';
import { ENTRY_MIME } from '../VaultTree/TreeNode';
import { VISION_UNSUPPORTED_MESSAGE } from '../../lib/brainErrors';
import type { ChatAttachment } from '../../lib/attachments/types';
import type { Connection } from '../../lib/llm/types';

const att = (name: string): ChatAttachment => ({
  vaultPath: name,
  absPath: `/vault/${name}`,
  name,
  kind: name.endsWith('.pdf') ? 'pdf' : 'image',
});

const conn = (visionModels: string[]): Connection => ({
  id: 'k',
  name: 'K',
  presetId: null,
  engine: 'openAiCompat',
  baseUrl: 'https://x',
  auth: { type: 'none' },
  authHeader: 'bearer',
  extraHeaders: [],
  caCertPath: null,
  azureApiVersion: null,
  models: ['m'],
  visionModels,
});

function setupAttachments(vision: boolean) {
  const query = vi.fn(async () => {});
  useBrainStore.setState({
    conversations: [],
    currentConversationId: null,
    messages: [],
    isLoading: false,
    error: null,
    pendingAttachments: [],
    notices: [],
    pendingPrompt: null,
    query,
  });
  useLlmStore.setState({ connections: [conn(vision ? ['m'] : [])], active: { connectionId: 'k', model: 'm' } });
  useVaultStore.setState({
    vaultPath: '/vault',
    tree: [{ name: 'flujo.png', path: '/vault/flujo.png', kind: 'file', file_type: 'image' }],
  });
  return query;
}

function dropEntry(target: HTMLElement, path: string) {
  const dataTransfer = {
    types: [ENTRY_MIME],
    getData: (t: string) => (t === ENTRY_MIME ? path : ''),
    dropEffect: '',
  };
  fireEvent.dragOver(target, { dataTransfer });
  fireEvent.drop(target, { dataTransfer });
}

describe('ChatPanel attachments', () => {
  it('shows queued attachments as chips and removes them', async () => {
    setupAttachments(true);
    useBrainStore.setState({ pendingAttachments: [att('flujo.png')] });
    renderChatPanel();
    expect(screen.getByTestId('chip-flujo.png')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Quitar flujo.png' }));
    expect(useBrainStore.getState().pendingAttachments).toEqual([]);
  });

  it('the paperclip opens the picker and attaches the chosen file', async () => {
    setupAttachments(true);
    renderChatPanel();
    await userEvent.click(screen.getByRole('button', { name: 'Adjuntar archivo' }));
    await userEvent.click(screen.getByText('flujo.png'));
    expect(useBrainStore.getState().pendingAttachments.map((a) => a.vaultPath)).toEqual(['flujo.png']);
    expect(screen.queryByTestId('attachment-picker')).not.toBeInTheDocument();
  });

  it('attaches a file dragged from the vault tree', () => {
    setupAttachments(true);
    renderChatPanel();
    dropEntry(screen.getByTestId('chat-panel'), '/vault/flujo.png');
    expect(useBrainStore.getState().pendingAttachments.map((a) => a.name)).toEqual(['flujo.png']);
  });

  it('rejects dragged files that are not images or PDFs', () => {
    setupAttachments(true);
    renderChatPanel();
    dropEntry(screen.getByTestId('chat-panel'), '/vault/nota.md');
    expect(useBrainStore.getState().pendingAttachments).toEqual([]);
    expect(screen.getByTestId('attachment-hint')).toHaveTextContent('Solo se pueden adjuntar imágenes y PDFs.');
  });

  it('reports when the limit of 5 is reached', () => {
    setupAttachments(true);
    useBrainStore.setState({
      pendingAttachments: ['1', '2', '3', '4', '5'].map((n) => att(`${n}.png`)),
    });
    renderChatPanel();
    dropEntry(screen.getByTestId('chat-panel'), '/vault/flujo.png');
    expect(screen.getByTestId('attachment-hint')).toHaveTextContent('Máximo 5 adjuntos por mensaje.');
    expect(useBrainStore.getState().pendingAttachments).toHaveLength(5);
  });

  it('blocks sending attachments to a model without vision and says why', async () => {
    const query = setupAttachments(false);
    useBrainStore.setState({ pendingAttachments: [att('flujo.png')] });
    renderChatPanel();
    expect(screen.getByTestId('vision-warning')).toHaveTextContent(VISION_UNSUPPORTED_MESSAGE);
    await userEvent.type(screen.getByTestId('chat-input'), 'hola');
    expect(screen.getByTestId('chat-send-btn')).toBeDisabled();
    expect(query).not.toHaveBeenCalled();
  });

  it('sends the question with attachments when the model sees images', async () => {
    const query = setupAttachments(true);
    useBrainStore.setState({ pendingAttachments: [att('flujo.png')] });
    renderChatPanel();
    expect(screen.queryByTestId('vision-warning')).not.toBeInTheDocument();
    await userEvent.type(screen.getByTestId('chat-input'), '¿qué ves?');
    await userEvent.click(screen.getByTestId('chat-send-btn'));
    expect(query).toHaveBeenCalledWith('¿qué ves?', '/vault');
  });

  it('shows store notices (e.g. truncated PDF)', () => {
    setupAttachments(true);
    useBrainStore.setState({ notices: ['«f.pdf» tiene 31 páginas: solo se usan las 20 primeras.'] });
    renderChatPanel();
    expect(screen.getByTestId('chat-notices')).toHaveTextContent('31 páginas');
  });

  it('a pending prompt without send fills and focuses the input', () => {
    setupAttachments(true);
    useBrainStore.setState({ pendingPrompt: { text: 'Explica esto', send: false, nonce: 1 } });
    renderChatPanel();
    expect(screen.getByTestId('chat-input')).toHaveValue('Explica esto');
    expect(screen.getByTestId('chat-input')).toHaveFocus();
    expect(useBrainStore.getState().pendingPrompt).toBeNull();
  });

  it('a pending prompt with send fires the query once', () => {
    const query = setupAttachments(true);
    useBrainStore.setState({
      pendingAttachments: [att('flujo.png')],
      pendingPrompt: { text: 'Explica en una nota', send: true, nonce: 2 },
    });
    renderChatPanel();
    expect(query).toHaveBeenCalledTimes(1);
    expect(query).toHaveBeenCalledWith('Explica en una nota', '/vault');
    expect(useBrainStore.getState().pendingPrompt).toBeNull();
  });

  it('a pending send-prompt only fills the input when the model has no vision', () => {
    const query = setupAttachments(false);
    useBrainStore.setState({
      pendingAttachments: [att('flujo.png')],
      pendingPrompt: { text: 'Explica en una nota', send: true, nonce: 3 },
    });
    renderChatPanel();
    expect(query).not.toHaveBeenCalled();
    expect(screen.getByTestId('chat-input')).toHaveValue('Explica en una nota');
    expect(screen.getByTestId('vision-warning')).toBeInTheDocument();
  });
});

describe('?ask=<path> from the graph', () => {
  function Where() {
    const { pathname, search } = useLocation();
    return <div data-testid="where">{pathname + search}</div>;
  }

  it('starts a conversation scoped to the note, focuses the composer and clears the param', () => {
    useBrainStore.setState({
      currentConversationId: 'old',
      messages: [{ id: 'm', role: 'user', content: 'x', sources: null, created_at: '' }],
      scope: { kind: 'vault' },
    });
    render(
      <MemoryRouter initialEntries={[`/brain?ask=${encodeURIComponent('Test/Primera nota.md')}`]}>
        <ChatPanel vaultPath="/vault" />
        <Where />
      </MemoryRouter>,
    );
    const s = useBrainStore.getState();
    expect(s.currentConversationId).toBeNull();
    expect(s.messages).toHaveLength(0);
    expect(s.scope).toEqual({ kind: 'notes', paths: ['Test/Primera nota.md'] });
    expect(screen.getByTestId('scope-chip')).toHaveTextContent('@ Esta nota · Primera nota');
    expect(screen.getByTestId('chat-input')).toHaveFocus();
    expect(screen.getByTestId('where').textContent).toBe('/brain');
  });

  it('sends the scope with the question and shows exactly what the user typed', async () => {
    useBrainStore.setState({ scope: { kind: 'notes', paths: ['a/Nota.md'] }, query: realQuery });
    vi.mocked(invoke).mockImplementation((async (cmd: string) =>
      cmd === 'brain_query'
        ? { answer: 'ok', sources: [], conversation_id: 'c', message_id: 'm' }
        : []) as never);
    renderChatPanel();
    await userEvent.type(screen.getByTestId('chat-input'), 'resume');
    await userEvent.click(screen.getByTestId('chat-send-btn'));
    expect(vi.mocked(invoke)).toHaveBeenCalledWith(
      'brain_query',
      expect.objectContaining({ question: 'resume', scope: { kind: 'notes', paths: ['a/Nota.md'] } }),
    );
    expect(screen.getByTestId('msg-bubble-user')).toHaveTextContent(/^resume$/);
  });

  it('changing the scope from the chip menu updates the store', async () => {
    useBrainStore.setState({ scope: { kind: 'folder', path: 'M' }, currentConversationId: null });
    renderChatPanel();
    await userEvent.click(screen.getByTestId('scope-chip'));
    await userEvent.click(screen.getByRole('menuitem', { name: /Toda la bóveda/ }));
    expect(useBrainStore.getState().scope).toEqual({ kind: 'vault' });
  });
});
