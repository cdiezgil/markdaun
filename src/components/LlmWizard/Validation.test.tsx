import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import React from 'react';
import { Validation } from './Validation';
import { PRESETS, draftFromPreset } from '../../lib/llm/presets';
import type { ProgressEvent } from '../../lib/llm/types';

const mockInvoke = vi.mocked(invoke);
const mockListen = vi.mocked(listen);

const draft = draftFromPreset(PRESETS.find((p) => p.id === 'anthropic-api')!);
const RESULT = { token: 'tok', available: ['a'], verified: ['a'] };

let emit: (e: ProgressEvent) => Promise<void>;

beforeEach(() => {
  vi.clearAllMocks();
  mockListen.mockImplementation((async (_name: string, cb: (e: { payload: ProgressEvent }) => void) => {
    emit = async (payload) => {
      await act(async () => cb({ payload }));
    };
    return () => {};
  }) as never);
});

function renderValidation(props: Partial<React.ComponentProps<typeof Validation>> = {}) {
  const onSuccess = vi.fn();
  const onContinue = vi.fn();
  const onBack = vi.fn();
  render(
    <Validation
      draft={draft}
      secret="sk"
      onSuccess={onSuccess}
      onContinue={onContinue}
      onBack={onBack}
      {...props}
    />,
  );
  return { onSuccess, onContinue, onBack };
}

const status = (step: string) => screen.getByTestId(`check-${step}`).getAttribute('data-status');

describe('Validation', () => {
  it('runs llm_validate with the draft and secret and shows live step status', async () => {
    let resolve!: (v: unknown) => void;
    mockInvoke.mockReturnValueOnce(new Promise((r) => (resolve = r)) as never);
    const { onSuccess } = renderValidation();

    await waitFor(() => expect(mockInvoke).toHaveBeenCalledWith('llm_validate', { draft, secret: 'sk' }));
    expect(status('reach')).toBe('pending');

    await emit({ step: 'reach', status: 'running' });
    expect(status('reach')).toBe('running');
    await emit({ step: 'reach', status: 'ok' });
    await emit({ step: 'credential', status: 'ok' });
    await emit({ step: 'models', status: 'ok', detail: '3 models' });
    await emit({ step: 'completion', status: 'ok' });
    expect(status('reach')).toBe('ok');
    expect(screen.getByTestId('check-models')).toHaveTextContent('3 models');

    await act(async () => resolve(RESULT));
    expect(onSuccess).toHaveBeenCalledWith(RESULT);
    expect(screen.getByTestId('validation-continue')).toBeEnabled();
  });

  it('continue goes to the next step', async () => {
    mockInvoke.mockResolvedValueOnce(RESULT as never);
    const { onContinue } = renderValidation();
    const btn = await screen.findByTestId('validation-continue');
    fireEvent.click(btn);
    expect(onContinue).toHaveBeenCalled();
  });

  it('stops at the first failure with a human message and action, and offers retry', async () => {
    mockInvoke.mockRejectedValueOnce({ kind: 'TlsUntrusted' });
    renderValidation();
    await emit({ step: 'reach', status: 'failed', error: { kind: 'TlsUntrusted' } });
    expect(status('reach')).toBe('failed');
    expect(status('credential')).toBe('pending');
    expect(await screen.findByTestId('validation-error')).toHaveTextContent(/certificado TLS/i);
    expect(screen.getByTestId('validation-error')).toHaveTextContent(/Avanzado/);
    expect(screen.queryByTestId('validation-continue')).not.toBeInTheDocument();

    mockInvoke.mockResolvedValueOnce(RESULT as never);
    fireEvent.click(screen.getByTestId('validation-retry'));
    await waitFor(() => expect(mockInvoke).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.getByTestId('validation-continue')).toBeInTheDocument());
    expect(screen.queryByTestId('validation-error')).not.toBeInTheDocument();
  });

  it('uses CLI wording for CLI engines and a back button', async () => {
    const cliDraft = draftFromPreset(PRESETS.find((p) => p.id === 'claude-code')!);
    mockInvoke.mockRejectedValueOnce({ kind: 'CliNotLoggedIn' });
    const { onBack } = renderValidation({ draft: cliDraft });
    expect(screen.getByTestId('check-reach')).toHaveTextContent(/CLI instalado/i);
    expect(screen.getByTestId('check-credential')).toHaveTextContent(/sesión/i);
    expect(await screen.findByTestId('validation-error')).toHaveTextContent(/ejecuta `claude`/i);
    fireEvent.click(screen.getByTestId('wizard-back'));
    expect(onBack).toHaveBeenCalled();
  });

  it('sends a null secret when none was typed', async () => {
    mockInvoke.mockResolvedValueOnce(RESULT as never);
    renderValidation({ secret: '  ' });
    await waitFor(() => expect(mockInvoke).toHaveBeenCalledWith('llm_validate', { draft, secret: null }));
  });
});
