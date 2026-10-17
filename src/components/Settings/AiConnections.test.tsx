import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { invoke } from '@tauri-apps/api/core';
import React from 'react';
import { AiConnections } from './AiConnections';
import { useLlmStore } from '../../store/llmStore';
import type { Connection } from '../../lib/llm/types';

const mockInvoke = vi.mocked(invoke);

const conn = (id: string, name: string, models: string[]): Connection => ({
  id,
  name,
  presetId: 'proxy',
  engine: 'openAiCompat',
  baseUrl: 'https://x',
  auth: { type: 'apiKey' },
  authHeader: 'bearer',
  extraHeaders: [],
  caCertPath: null,
  azureApiVersion: null,
  models,
  visionModels: [],
});

beforeEach(() => {
  vi.clearAllMocks();
  mockInvoke.mockImplementation((async (cmd: string) => {
    if (cmd === 'llm_list_connections') return [conn('a', 'Casa', ['m1'])];
    return undefined;
  }) as never);
  useLlmStore.setState({
    connections: [conn('a', 'Casa', ['m1', 'm2']), conn('b', 'Oficina', ['gpt-4.1'])],
    active: { connectionId: 'a', model: 'm1' },
    loaded: true,
    error: null,
    wizardOpen: false,
    editing: null,
  });
});

describe('AiConnections', () => {
  it('lists connections with their models and marks the active one', () => {
    render(<AiConnections />);
    expect(screen.getByTestId('ai-connection-a')).toHaveTextContent('Casa');
    expect(screen.getByTestId('ai-connection-a')).toHaveTextContent('m1, m2');
    expect(screen.getByTestId('ai-connection-a')).toHaveTextContent(/activa/i);
    expect(screen.getByTestId('ai-connection-b')).not.toHaveTextContent(/activa/i);
  });

  it('shows an empty state', () => {
    useLlmStore.setState({ connections: [], active: null });
    render(<AiConnections />);
    expect(screen.getByTestId('ai-connections-empty')).toBeInTheDocument();
  });

  it('add opens the wizard for a new connection', () => {
    render(<AiConnections />);
    fireEvent.click(screen.getByTestId('ai-add'));
    expect(useLlmStore.getState().wizardOpen).toBe(true);
    expect(useLlmStore.getState().editing).toBeNull();
  });

  it('edit opens the wizard with the connection', () => {
    render(<AiConnections />);
    fireEvent.click(screen.getByTestId('ai-edit-b'));
    expect(useLlmStore.getState().editing?.id).toBe('b');
  });

  it('duplicate opens the wizard with an unsaved copy', () => {
    render(<AiConnections />);
    fireEvent.click(screen.getByTestId('ai-duplicate-a'));
    const ed = useLlmStore.getState().editing!;
    expect(ed.id).toBe('');
    expect(ed.name).toBe('Casa (copia)');
    expect(ed.models).toEqual(['m1', 'm2']);
  });

  it('delete asks for confirmation, then calls llm_delete_connection', async () => {
    render(<AiConnections />);
    fireEvent.click(screen.getByTestId('ai-delete-b'));
    expect(mockInvoke).not.toHaveBeenCalledWith('llm_delete_connection', expect.anything());
    const dialog = screen.getByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Eliminar' }));
    await waitFor(() => expect(mockInvoke).toHaveBeenCalledWith('llm_delete_connection', { id: 'b' }));
  });

  it('cancelling the confirmation keeps the connection', () => {
    render(<AiConnections />);
    fireEvent.click(screen.getByTestId('ai-delete-b'));
    fireEvent.click(screen.getByRole('button', { name: /cancelar/i }));
    expect(mockInvoke).not.toHaveBeenCalledWith('llm_delete_connection', expect.anything());
  });
});
