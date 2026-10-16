import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { invoke } from '@tauri-apps/api/core';
import { useBrainStore } from '../../store/brainStore';
import { ChatPanel } from './ChatPanel';
import React from 'react';

vi.mocked(invoke);

beforeEach(() => {
  vi.clearAllMocks();
  useBrainStore.setState({
    isConfigured: true,
    config: { endpoint_url: 'https://x', model: 'm' },
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
