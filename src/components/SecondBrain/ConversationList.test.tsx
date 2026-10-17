import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { invoke } from '@tauri-apps/api/core';
import { useBrainStore } from '../../store/brainStore';
import { ConversationList } from './ConversationList';
import React from 'react';
import { MemoryRouter } from 'react-router-dom';

const renderList = () =>
  render(
    <MemoryRouter>
      <ConversationList vaultPath="/vault" />
    </MemoryRouter>,
  );

const mockInvoke = vi.mocked(invoke);

const MOCK_CONVS = [
  { id: 'conv-1', title: 'Notas de viaje', created_at: '2024-01-02T00:00:00Z' },
  { id: 'conv-2', title: 'Ideas Python', created_at: '2024-01-01T00:00:00Z' },
];

beforeEach(() => {
  vi.clearAllMocks();
  useBrainStore.setState({
    conversations: MOCK_CONVS,
    currentConversationId: null,
    messages: [],
    filterQuery: '',
    isLoading: false,
    error: null,
  });
});

// ── TC-27: renders conversation items ────────────────────────────────────────

describe('TC-27: ConversationList renders items', () => {
  it('TC-27: renders all conversations as list items', () => {
    renderList();

    expect(screen.getByTestId('conversation-list')).toBeInTheDocument();
    expect(screen.getByTestId('conv-item-conv-1')).toBeInTheDocument();
    expect(screen.getByTestId('conv-item-conv-2')).toBeInTheDocument();
    expect(screen.getByText('Notas de viaje')).toBeInTheDocument();
    expect(screen.getByText('Ideas Python')).toBeInTheDocument();
  });
});

// ── TC-28: search filters the list ───────────────────────────────────────────

describe('TC-28: ConversationList search filters', () => {
  it('TC-28: typing in search input filters displayed conversations', () => {
    renderList();

    fireEvent.change(screen.getByTestId('conv-search-input'), {
      target: { value: 'python' },
    });

    expect(screen.getByText('Ideas Python')).toBeInTheDocument();
    expect(screen.queryByText('Notas de viaje')).not.toBeInTheDocument();
  });
});

// ── TC-29: clicking "Nueva conversación" calls startNewConversation ────────────

describe('TC-29: ConversationList new conversation', () => {
  it('TC-29: clicking new conversation button resets state', () => {
    useBrainStore.setState({ currentConversationId: 'conv-1' });
    renderList();

    fireEvent.click(screen.getByTestId('new-conversation-btn'));

    expect(useBrainStore.getState().currentConversationId).toBeNull();
    expect(useBrainStore.getState().messages).toHaveLength(0);
  });
});

// ── TC-34b: delete button triggers confirm dialog ─────────────────────────────

describe('TC-34b: delete conversation shows confirm', () => {
  it('TC-34b: clicking delete icon opens the ConfirmDialog', () => {
    renderList();

    fireEvent.click(screen.getByTestId('conv-delete-conv-1'));

    // Confirm dialog should appear
    expect(screen.getByTestId('confirm-dialog-overlay')).toBeInTheDocument();
  });
});

describe('ConversationList design', () => {
  it('groups by day with a time under each title, and shows the vault footer', () => {
    const now = new Date();
    useBrainStore.setState({
      conversations: [
        { id: 'c1', title: 'Hoy una', created_at: now.toISOString() },
        { id: 'c2', title: 'Vieja', created_at: new Date(2020, 0, 5, 10, 30).toISOString() },
      ],
    });
    renderList();
    expect(screen.getByRole('region', { name: 'Hoy' })).toHaveTextContent('Hoy una');
    expect(screen.getByRole('region', { name: /ene/i })).toHaveTextContent('10:30');
    expect(screen.getByTestId('vault-footer')).toHaveTextContent('0 notas · 0 carpetas');
    expect(screen.getByTestId('settings-link')).toHaveAttribute('href', '/settings');
  });

  it('marks the active conversation with daun', () => {
    useBrainStore.setState({ currentConversationId: 'conv-1' });
    renderList();
    expect(screen.getByTestId('conv-item-conv-1').style.color).toBe('var(--daun)');
    expect(screen.getByTestId('conv-item-conv-2').style.color).toBe('var(--ink)');
  });
});
