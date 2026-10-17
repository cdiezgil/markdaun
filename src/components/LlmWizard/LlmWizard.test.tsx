import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { invoke } from '@tauri-apps/api/core';
import React from 'react';
import { LlmWizard } from './LlmWizard';
import { useLlmStore } from '../../store/llmStore';
import type { Connection } from '../../lib/llm/types';

const mockInvoke = vi.mocked(invoke);

function backend(overrides: Record<string, (args: unknown) => unknown> = {}) {
  mockInvoke.mockImplementation((async (cmd: string, args?: unknown) => {
    if (overrides[cmd]) return overrides[cmd](args);
    switch (cmd) {
      case 'llm_detect_cli':
        return { installed: true, path: '/opt/homebrew/bin/claude' };
      case 'llm_validate':
        return { token: 'tok', available: ['opus', 'sonnet'], verified: ['opus', 'sonnet'] };
      case 'llm_save_connection':
        return { ...(args as { draft: Connection }).draft, id: 'new-id' };
      case 'llm_list_connections':
        return [];
      case 'llm_get_active':
        return null;
      default:
        return undefined;
    }
  }) as never);
}

beforeEach(() => {
  vi.clearAllMocks();
  useLlmStore.setState({ connections: [], active: null, loaded: true, error: null, wizardOpen: true, editing: null });
});

describe('LlmWizard', () => {
  it('walks route -> provider -> credentials -> validation -> models -> save for a CLI', async () => {
    backend();
    render(<LlmWizard />);

    expect(screen.getByTestId('step-route')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('route-subscription'));
    fireEvent.click(await screen.findByTestId('preset-claude-code'));

    await waitFor(() => expect(screen.getByTestId('credentials-next')).toBeEnabled());
    fireEvent.click(screen.getByTestId('credentials-next'));

    fireEvent.click(await screen.findByTestId('validation-continue'));
    fireEvent.click(await screen.findByTestId('save-btn'));

    await waitFor(() =>
      expect(mockInvoke).toHaveBeenCalledWith(
        'llm_save_connection',
        expect.objectContaining({ validationToken: 'tok', secret: null }),
      ),
    );
    // closes and reloads the connections
    await waitFor(() => expect(useLlmStore.getState().wizardOpen).toBe(false));
    expect(mockInvoke).toHaveBeenCalledWith('llm_list_connections');
  });

  it('never reaches the models/save step when validation fails', async () => {
    backend({
      llm_validate: () => {
        throw { kind: 'Unauthorized' };
      },
    });
    render(<LlmWizard />);
    fireEvent.click(screen.getByTestId('route-apiKey'));
    fireEvent.click(await screen.findByTestId('preset-anthropic-api'));
    fireEvent.change(screen.getByTestId('secret-input'), { target: { value: 'sk-bad' } });
    fireEvent.click(screen.getByTestId('credentials-next'));

    expect(await screen.findByTestId('validation-error')).toHaveTextContent(/rechazó/i);
    expect(screen.queryByTestId('step-models')).not.toBeInTheDocument();
    expect(screen.queryByTestId('save-btn')).not.toBeInTheDocument();
    expect(mockInvoke).not.toHaveBeenCalledWith('llm_save_connection', expect.anything());
  });

  it('back from validation returns to credentials with the entered values', async () => {
    backend({
      llm_validate: () => {
        throw { kind: 'Unreachable' };
      },
    });
    render(<LlmWizard />);
    fireEvent.click(screen.getByTestId('route-apiKey'));
    fireEvent.click(await screen.findByTestId('preset-kimi-api'));
    fireEvent.change(screen.getByTestId('secret-input'), { target: { value: 'k1' } });
    fireEvent.click(screen.getByTestId('credentials-next'));
    await screen.findByTestId('validation-error');
    fireEvent.click(screen.getByTestId('wizard-back'));
    expect(await screen.findByTestId('secret-input')).toHaveValue('k1');
  });

  it('editing a saved connection starts at credentials and re-validates before saving', async () => {
    backend();
    const saved: Connection = {
      id: 'abc',
      name: 'Casa',
      presetId: 'claude-code',
      engine: 'cliClaude',
      baseUrl: null,
      auth: { type: 'none' },
      authHeader: 'bearer',
      extraHeaders: [],
      caCertPath: null,
      azureApiVersion: null,
      models: ['opus'],
    };
    useLlmStore.setState({ editing: saved });
    render(<LlmWizard />);
    expect(screen.getByTestId('step-credentials')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId('credentials-next')).toBeEnabled());
    fireEvent.click(screen.getByTestId('credentials-next'));
    await screen.findByTestId('validation-continue');
    expect(mockInvoke).toHaveBeenCalledWith('llm_validate', expect.objectContaining({ secret: null }));
  });

  it('shows a step indicator and can be closed', () => {
    backend();
    render(<LlmWizard />);
    expect(screen.getByLabelText('Pasos')).toBeInTheDocument();
    expect(screen.getByText('Ruta').closest('li')).toHaveAttribute('aria-current', 'step');
    fireEvent.click(screen.getByTestId('wizard-close'));
    expect(useLlmStore.getState().wizardOpen).toBe(false);
  });

  it('renders nothing when closed', () => {
    useLlmStore.setState({ wizardOpen: false });
    const { container } = render(<LlmWizard />);
    expect(container).toBeEmptyDOMElement();
  });
});
