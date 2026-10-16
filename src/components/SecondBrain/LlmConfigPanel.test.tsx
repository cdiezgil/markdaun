import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { invoke } from '@tauri-apps/api/core';
import { useBrainStore } from '../../store/brainStore';
import { LlmConfigPanel } from './LlmConfigPanel';
import React from 'react';

const mockInvoke = vi.mocked(invoke);

beforeEach(() => {
  vi.clearAllMocks();
  useBrainStore.setState({
    isConfigured: false,
    config: { endpoint_url: null, model: null },
    isLoading: false,
    error: null,
    conversations: [],
    currentConversationId: null,
    messages: [],
    filterQuery: '',
  });
});

// ── TC-25: LlmConfigPanel renders when not configured ─────────────────────────

describe('TC-25: LlmConfigPanel rendering', () => {
  it('TC-25: renders the config panel with all fields', () => {
    render(<LlmConfigPanel />);

    expect(screen.getByTestId('llm-config-panel')).toBeInTheDocument();
    expect(screen.getByTestId('llm-endpoint-input')).toBeInTheDocument();
    expect(screen.getByTestId('llm-apikey-input')).toBeInTheDocument();
    expect(screen.getByTestId('llm-model-input')).toBeInTheDocument();
    expect(screen.getByTestId('llm-save-btn')).toBeInTheDocument();
  });
});

// ── TC-26: saving calls configure ─────────────────────────────────────────────

describe('TC-26: LlmConfigPanel save', () => {
  it('TC-26: filling the form and clicking save calls configure', async () => {
    mockInvoke.mockResolvedValueOnce(undefined); // brain_configure

    render(<LlmConfigPanel />);

    fireEvent.change(screen.getByTestId('llm-endpoint-input'), {
      target: { value: 'https://api.openai.com/v1/chat/completions' },
    });
    fireEvent.change(screen.getByTestId('llm-model-input'), {
      target: { value: 'gpt-4o-mini' },
    });
    fireEvent.click(screen.getByTestId('llm-save-btn'));

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith('brain_configure', expect.objectContaining({
        endpoint_url: 'https://api.openai.com/v1/chat/completions',
        model: 'gpt-4o-mini',
      }));
    });
  });
});
