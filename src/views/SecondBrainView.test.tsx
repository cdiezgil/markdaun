import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { invoke } from '@tauri-apps/api/core';
import { useBrainStore } from '../store/brainStore';
import { useLlmStore } from '../store/llmStore';
import { useVaultStore } from '../store/vaultStore';
import { SecondBrainView } from './SecondBrainView';
import React from 'react';

const mockInvoke = vi.mocked(invoke);

beforeEach(() => {
  vi.clearAllMocks();
  mockInvoke.mockResolvedValue(undefined as never);

  useBrainStore.setState({
    conversations: [],
    currentConversationId: null,
    messages: [],
    filterQuery: '',
    isLoading: false,
    error: null,
  });
  useLlmStore.setState({ connections: [], active: null, loaded: true, error: null });
  useVaultStore.setState({ vaultPath: '/vault', tree: [], isLoading: false, error: null });
});

function renderView() {
  return render(
    <MemoryRouter>
      <SecondBrainView />
    </MemoryRouter>,
  );
}

describe('SecondBrainView', () => {
  it('TC-25b: shows the setup prompt when there is no active connection', () => {
    renderView();
    expect(screen.getByTestId('second-brain-view')).toBeInTheDocument();
    expect(screen.getByTestId('setup-prompt')).toBeInTheDocument();
    expect(screen.queryByTestId('chat-panel')).not.toBeInTheDocument();
  });

  it('TC-27b: renders ConversationList + ChatPanel when a connection is active', () => {
    useLlmStore.setState({ active: { connectionId: 'a', model: 'm' } });
    renderView();
    expect(screen.getByTestId('conversation-list')).toBeInTheDocument();
    expect(screen.getByTestId('chat-panel')).toBeInTheDocument();
    expect(screen.queryByTestId('setup-prompt')).not.toBeInTheDocument();
  });

  it('renders neither before the first load completes', () => {
    useLlmStore.setState({ loaded: false });
    renderView();
    expect(screen.queryByTestId('setup-prompt')).not.toBeInTheDocument();
    expect(screen.queryByTestId('chat-panel')).not.toBeInTheDocument();
  });
});
