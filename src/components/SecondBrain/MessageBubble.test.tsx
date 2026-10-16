import { describe, it, expect, vi } from 'vitest';
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
