import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { invoke } from '@tauri-apps/api/core';
import React from 'react';
import { ModelSwitcher } from './ModelSwitcher';
import { useLlmStore } from '../../store/llmStore';
import type { Connection } from '../../lib/llm/types';

const mockInvoke = vi.mocked(invoke);

const conn = (id: string, name: string, models: string[]): Connection => ({
  id,
  name,
  presetId: null,
  engine: 'openAiCompat',
  baseUrl: 'https://x',
  auth: { type: 'none' },
  authHeader: 'bearer',
  extraHeaders: [],
  caCertPath: null,
  azureApiVersion: null,
  models,
  visionModels: [],
});

const HOME = conn('h', 'Casa', ['opus', 'sonnet']);
const OFFICE = conn('o', 'Oficina', ['gpt-4.1']);

function seed(over: Partial<ReturnType<typeof useLlmStore.getState>> = {}) {
  useLlmStore.setState({
    connections: [HOME, OFFICE],
    active: { connectionId: 'h', model: 'opus' },
    loaded: true,
    error: null,
    wizardOpen: false,
    editing: null,
    ...over,
  });
}

function renderSwitcher() {
  return render(
    <MemoryRouter initialEntries={['/']}>
      <ModelSwitcher />
      <Routes>
        <Route path="/" element={<div>home</div>} />
        <Route path="/settings" element={<div data-testid="settings-page">settings</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mockInvoke.mockImplementation((async (cmd: string) => {
    if (cmd === 'llm_list_connections') return [HOME, OFFICE];
    if (cmd === 'llm_get_active') return { connectionId: 'h', model: 'opus' };
    return undefined;
  }) as never);
});

describe('ModelSwitcher', () => {
  it('shows the active selection as "<connection> · <model>", rendered in flow (not floating)', () => {
    seed();
    renderSwitcher();
    const pill = screen.getByTestId('model-pill');
    expect(pill).toHaveTextContent('Casa · opus');
    const wrapper = screen.getByTestId('model-switcher');
    expect(wrapper.style.position).toBe('relative');
  });

  it('opens the popover upwards (anchored above the pill)', () => {
    seed();
    renderSwitcher();
    fireEvent.click(screen.getByTestId('model-pill'));
    expect(screen.getByTestId('model-popover').style.bottom).toContain('100%');
    expect(screen.getByTestId('model-popover').style.top).toBe('');
  });

  it('opens a popover with connections grouped and their models', () => {
    seed();
    renderSwitcher();
    expect(screen.queryByTestId('model-popover')).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId('model-pill'));
    expect(screen.getByTestId('model-popover')).toBeInTheDocument();
    expect(screen.getByText('Casa')).toBeInTheDocument();
    expect(screen.getByText('Oficina')).toBeInTheDocument();
    expect(screen.getByTestId('model-option-h-opus')).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByTestId('model-option-h-sonnet')).toHaveAttribute('aria-selected', 'false');
    expect(screen.getByTestId('model-option-o-gpt-4.1')).toBeInTheDocument();
  });

  it('selecting a model persists via llm_set_active and closes the popover', async () => {
    seed();
    mockInvoke.mockImplementation((async (cmd: string) => {
      if (cmd === 'llm_set_active') return { connectionId: 'o', model: 'gpt-4.1' };
      return undefined;
    }) as never);
    renderSwitcher();
    fireEvent.click(screen.getByTestId('model-pill'));
    fireEvent.click(screen.getByTestId('model-option-o-gpt-4.1'));
    await waitFor(() =>
      expect(mockInvoke).toHaveBeenCalledWith('llm_set_active', { connectionId: 'o', model: 'gpt-4.1' }),
    );
    await waitFor(() => expect(screen.queryByTestId('model-popover')).not.toBeInTheDocument());
    expect(screen.getByTestId('model-pill')).toHaveTextContent('Oficina · gpt-4.1');
  });

  it('empty state reads "Configurar IA" and opens the wizard', () => {
    seed({ connections: [], active: null });
    mockInvoke.mockImplementation((async () => (undefined)) as never);
    renderSwitcher();
    const pill = screen.getByTestId('model-pill');
    expect(pill).toHaveTextContent('Configurar IA');
    fireEvent.click(pill);
    expect(useLlmStore.getState().wizardOpen).toBe(true);
  });

  it('"+ Añadir conexión" opens the wizard and "Gestionar" goes to settings', () => {
    seed();
    renderSwitcher();
    fireEvent.click(screen.getByTestId('model-pill'));
    fireEvent.click(screen.getByTestId('model-add'));
    expect(useLlmStore.getState().wizardOpen).toBe(true);

    fireEvent.click(screen.getByTestId('model-pill'));
    fireEvent.click(screen.getByTestId('model-manage'));
    expect(screen.getByTestId('settings-page')).toBeInTheDocument();
  });

  it('closes on Escape and on outside click', () => {
    seed();
    renderSwitcher();
    fireEvent.click(screen.getByTestId('model-pill'));
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByTestId('model-popover')).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId('model-pill'));
    fireEvent.mouseDown(document.body);
    expect(screen.queryByTestId('model-popover')).not.toBeInTheDocument();
  });

  it('loads connections on mount and renders nothing until loaded', async () => {
    seed({ loaded: false, connections: [], active: null });
    renderSwitcher();
    expect(screen.queryByTestId('model-switcher')).not.toBeInTheDocument();
    await waitFor(() => expect(mockInvoke).toHaveBeenCalledWith('llm_list_connections'));
    expect(await screen.findByTestId('model-pill')).toHaveTextContent('Casa · opus');
  });
});
