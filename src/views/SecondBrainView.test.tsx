import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { invoke } from '@tauri-apps/api/core';
import { useBrainStore } from '../store/brainStore';
import { useVaultStore } from '../store/vaultStore';
import { SecondBrainView } from './SecondBrainView';
import React from 'react';

const mockInvoke = vi.mocked(invoke);

beforeEach(() => {
  vi.clearAllMocks();
  // Suppress store side-effects for initial loadConfig and loadConversations
  mockInvoke.mockResolvedValue(undefined as never);

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
  useVaultStore.setState({ vaultPath: '/vault', tree: [], isLoading: false, error: null });
});

function renderView() {
  return render(
    <MemoryRouter>
      <SecondBrainView />
    </MemoryRouter>,
  );
}

// ── TC-25b: shows LlmConfigPanel when not configured ─────────────────────────

describe('TC-25b: SecondBrainView shows config panel', () => {
  it('TC-25b: renders LlmConfigPanel when isConfigured is false', () => {
    renderView();
    expect(screen.getByTestId('second-brain-view')).toBeInTheDocument();
    expect(screen.getByTestId('llm-config-panel')).toBeInTheDocument();
  });
});

// ── TC-27b: shows chat layout when configured ─────────────────────────────────

describe('TC-27b: SecondBrainView shows chat when configured', () => {
  it('TC-27b: renders ConversationList + ChatPanel when isConfigured is true', () => {
    useBrainStore.setState({
      isConfigured: true,
      config: { endpoint_url: 'https://x', model: 'm' },
    });

    renderView();

    expect(screen.getByTestId('second-brain-view')).toBeInTheDocument();
    expect(screen.getByTestId('conversation-list')).toBeInTheDocument();
    expect(screen.getByTestId('chat-panel')).toBeInTheDocument();
  });
});
