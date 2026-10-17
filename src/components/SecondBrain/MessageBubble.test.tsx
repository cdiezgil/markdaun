import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MessageBubble } from './MessageBubble';
import type { BrainMessage } from '../../store/brainStore';
import React from 'react';

function makeMsg(overrides: Partial<BrainMessage>): BrainMessage {
  return {
    id: 'msg-1',
    role: 'user',
    content: 'hola',
    sources: null,
    created_at: '2024-01-01T00:00:00Z',
    ...overrides,
  };
}

// ── TC-30: user bubble renders with correct styling ────────────────────────────

describe('TC-30: MessageBubble user role', () => {
  it('TC-30: renders user bubble', () => {
    render(<MessageBubble message={makeMsg({ role: 'user' })} onSourceClick={vi.fn()} />);
    expect(screen.getByTestId('msg-bubble-user')).toBeInTheDocument();
    // No sources for user
    expect(screen.queryByTestId('msg-source-0')).not.toBeInTheDocument();
  });
});

// ── TC-31: assistant bubble shows source superscript ──────────────────────────

describe('TC-31: MessageBubble assistant with sources', () => {
  it('TC-31: renders source superscript with filename without extension', () => {
    const msg = makeMsg({
      role: 'assistant',
      content: 'Según tus notas...',
      sources: ['/vault/a.md'],
    });
    render(<MessageBubble message={msg} onSourceClick={vi.fn()} />);

    expect(screen.getByTestId('msg-bubble-assistant')).toBeInTheDocument();
    expect(screen.getByTestId('msg-source-0')).toBeInTheDocument();
    // Should display filename without extension
    expect(screen.getByText('a')).toBeInTheDocument();
  });
});

// ── TC-32: clicking source calls onSourceClick ────────────────────────────────

describe('TC-32: MessageBubble source click', () => {
  it('TC-32: onSourceClick called with the file path', () => {
    const onSourceClick = vi.fn();
    const msg = makeMsg({
      role: 'assistant',
      content: 'resp',
      sources: ['/vault/nota.md'],
    });
    render(<MessageBubble message={msg} onSourceClick={onSourceClick} />);

    fireEvent.click(screen.getByTestId('msg-source-0'));
    expect(onSourceClick).toHaveBeenCalledWith('/vault/nota.md');
  });
});

describe('MessageBubble warning and failure', () => {
  it('renders the warning note under an assistant answer with the muted token', () => {
    render(
      <MessageBubble
        message={makeMsg({ role: 'assistant', warning: 'notes_context_unavailable: boom' })}
        onSourceClick={vi.fn()}
      />,
    );
    const note = screen.getByTestId('msg-warning');
    expect(note).toHaveTextContent(/boom/);
    expect(note.style.color).toBe('var(--ink-muted)');
  });

  it('renders no warning when absent', () => {
    render(<MessageBubble message={makeMsg({ role: 'assistant' })} onSourceClick={vi.fn()} />);
    expect(screen.queryByTestId('msg-warning')).not.toBeInTheDocument();
  });

  it('marks a failed user message', () => {
    render(<MessageBubble message={makeMsg({ role: 'user', failed: true })} onSourceClick={vi.fn()} />);
    expect(screen.getByTestId('msg-failed')).toBeInTheDocument();
  });
});

// ── Phase B: note proposals and Save as note ──────────────────────────────────
import { waitFor } from '@testing-library/react';
import { invoke } from '@tauri-apps/api/core';
import { useNoteProposalStore } from '../../store/noteProposalStore';

const NOTE_MD =
  'Aquí tienes:\n```markdaun-note path="Ideas/nueva.md" mode="create"\n# Nueva\ncuerpo\n```\nHecho.';

function noteCtx(over = {}) {
  return {
    vaultPath: '/vault',
    conversationTitle: 'Mi charla',
    folders: ['', 'Ideas'],
    onOpenNote: vi.fn(),
    onNoteWritten: vi.fn(),
    ...over,
  };
}

describe('MessageBubble note proposals', () => {
  beforeEach(() => {
    useNoteProposalStore.setState({ states: {} });
    vi.mocked(invoke).mockImplementation((async (cmd: string) => {
      if (cmd === 'note_exists') return false;
      if (cmd === 'chat_write_note') return '/vault/Ideas/nueva.md';
      return undefined;
    }) as never);
  });

  it('renders text around the block and a card for the proposal', () => {
    render(
      <MessageBubble message={makeMsg({ id: 'a1', role: 'assistant', content: NOTE_MD })}
        onSourceClick={vi.fn()} noteContext={noteCtx()} />,
    );
    expect(screen.getByTestId('msg-bubble-assistant')).toHaveTextContent('Aquí tienes:');
    expect(screen.getByTestId('msg-bubble-assistant')).toHaveTextContent('Hecho.');
    expect(screen.getByTestId('msg-bubble-assistant')).not.toHaveTextContent('markdaun-note');
    expect(screen.getByTestId('proposal-path')).toHaveValue('Ideas/nueva.md');
  });

  it('keeps card state across re-renders and remounts', async () => {
    const msg = makeMsg({ id: 'a2', role: 'assistant', content: NOTE_MD });
    const ctx = noteCtx();
    const { unmount } = render(<MessageBubble message={msg} onSourceClick={vi.fn()} noteContext={ctx} />);
    fireEvent.click(screen.getByTestId('proposal-accept'));
    await waitFor(() => expect(screen.getByTestId('proposal-done')).toHaveTextContent('Creada'));
    expect(ctx.onNoteWritten).toHaveBeenCalled();
    unmount();
    render(<MessageBubble message={msg} onSourceClick={vi.fn()} noteContext={ctx} />);
    expect(screen.getByTestId('proposal-done')).toHaveTextContent('Creada');
    fireEvent.click(screen.getByText('Abrir'));
    expect(ctx.onOpenNote).toHaveBeenCalledWith('/vault/Ideas/nueva.md');
  });

  it('does not render cards without a note context (plain text)', () => {
    render(<MessageBubble message={makeMsg({ role: 'assistant', content: NOTE_MD })} onSourceClick={vi.fn()} />);
    expect(screen.queryByTestId('proposal-path')).not.toBeInTheDocument();
    expect(screen.getByTestId('msg-bubble-assistant')).toHaveTextContent('markdaun-note');
  });

  it('still shows the warning on assistant messages', () => {
    render(
      <MessageBubble message={makeMsg({ role: 'assistant', content: 'x', warning: 'embedding_failed' } as never)}
        onSourceClick={vi.fn()} noteContext={noteCtx()} />,
    );
    expect(screen.getByTestId('msg-warning')).toBeInTheDocument();
  });

  it('offers Guardar como nota on assistant messages only and saves via the dialog', async () => {
    const ctx = noteCtx();
    render(
      <MessageBubble message={makeMsg({ id: 'a3', role: 'assistant', content: 'Respuesta' })}
        onSourceClick={vi.fn()} noteContext={ctx} />,
    );
    fireEvent.click(screen.getByTestId('msg-save-as-note'));
    expect(screen.getByTestId('save-note-name')).toHaveValue('mi-charla.md');
    fireEvent.click(screen.getByTestId('save-note-submit'));
    await waitFor(() => expect(ctx.onNoteWritten).toHaveBeenCalled());
    expect(vi.mocked(invoke)).toHaveBeenCalledWith('chat_write_note', {
      path: 'mi-charla.md', content: 'Respuesta', mode: 'create', vaultPath: '/vault',
    });
    expect(screen.queryByTestId('save-note-name')).not.toBeInTheDocument();
  });

  it('shows no Save as note action on user messages', () => {
    render(<MessageBubble message={makeMsg({ role: 'user' })} onSourceClick={vi.fn()} noteContext={noteCtx()} />);
    expect(screen.queryByTestId('msg-save-as-note')).not.toBeInTheDocument();
  });
});
