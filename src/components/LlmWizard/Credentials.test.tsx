import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { invoke } from '@tauri-apps/api/core';
import { openUrl } from '@tauri-apps/plugin-opener';
import { open as openDialog } from '@tauri-apps/plugin-dialog';
import React, { useState } from 'react';
import { Credentials } from './Credentials';
import { PRESETS, draftFromPreset } from '../../lib/llm/presets';
import type { Connection } from '../../lib/llm/types';

const mockInvoke = vi.mocked(invoke);
const mockOpenUrl = vi.mocked(openUrl);
const mockDialog = vi.mocked(openDialog);

const preset = (id: string) => PRESETS.find((p) => p.id === id)!;

/** Stateful harness: Credentials is controlled by its parent. */
function Harness({ presetId, initial, onNext }: { presetId: string; initial?: Connection; onNext?: () => void }) {
  const p = preset(presetId);
  const [draft, setDraft] = useState<Connection>(initial ?? draftFromPreset(p));
  const [secret, setSecret] = useState('');
  return (
    <Credentials
      preset={p}
      draft={draft}
      secret={secret}
      onChange={setDraft}
      onSecret={setSecret}
      onBack={() => {}}
      onNext={onNext ?? (() => {})}
    />
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('Credentials — CLI', () => {
  it('detects the CLI and enables Continue only when installed', async () => {
    mockInvoke.mockResolvedValue({ installed: false, path: null } as never);
    render(<Harness presetId="claude-code" />);
    await waitFor(() => expect(mockInvoke).toHaveBeenCalledWith('llm_detect_cli', { engine: 'cliClaude' }));
    expect(await screen.findByTestId('cli-status')).toHaveTextContent(/no encontrado/i);
    expect(screen.getByTestId('credentials-next')).toBeDisabled();
    expect(screen.getByTestId('cli-instructions')).toHaveTextContent('claude');

    mockInvoke.mockResolvedValue({ installed: true, path: '/opt/homebrew/bin/claude' } as never);
    fireEvent.click(screen.getByTestId('cli-check-again'));
    expect(await screen.findByText(/instalado/i)).toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId('credentials-next')).toBeEnabled());
  });

  it('has no key or URL inputs', async () => {
    mockInvoke.mockResolvedValue({ installed: true, path: '/x' } as never);
    render(<Harness presetId="gemini-cli" />);
    await screen.findByTestId('cli-status');
    expect(screen.queryByTestId('secret-input')).not.toBeInTheDocument();
    expect(screen.queryByTestId('base-url-input')).not.toBeInTheDocument();
  });
});

describe('Credentials — API key', () => {
  it('requires a key before continuing and opens the key page', () => {
    const onNext = vi.fn();
    render(<Harness presetId="anthropic-api" onNext={onNext} />);
    expect(screen.getByTestId('base-url-input')).toHaveValue('https://api.anthropic.com');
    // Prefilled from the preset catalog (model names re-verified in Task 20).
    expect(screen.getByTestId('test-model-input')).toHaveValue(preset('anthropic-api').suggestedModels[0]);
    expect(screen.getByTestId('credentials-next')).toBeDisabled();

    fireEvent.click(screen.getByTestId('open-key-page'));
    expect(mockOpenUrl).toHaveBeenCalledWith('https://console.anthropic.com/settings/keys');

    fireEvent.change(screen.getByTestId('secret-input'), { target: { value: 'sk-ant-123' } });
    expect(screen.getByTestId('secret-input')).toHaveAttribute('type', 'password');
    expect(screen.getByTestId('credentials-next')).toBeEnabled();
    fireEvent.click(screen.getByTestId('credentials-next'));
    expect(onNext).toHaveBeenCalled();
  });

  it('blocks Continue on an invalid URL or empty model', () => {
    render(<Harness presetId="kimi-api" />);
    fireEvent.change(screen.getByTestId('secret-input'), { target: { value: 'k' } });
    expect(screen.getByTestId('credentials-next')).toBeEnabled();
    fireEvent.change(screen.getByTestId('base-url-input'), { target: { value: 'not a url' } });
    expect(screen.getByTestId('credentials-next')).toBeDisabled();
    fireEvent.change(screen.getByTestId('base-url-input'), { target: { value: 'https://api.moonshot.ai/v1' } });
    fireEvent.change(screen.getByTestId('test-model-input'), { target: { value: '  ' } });
    expect(screen.getByTestId('credentials-next')).toBeDisabled();
  });

  it('when editing a saved connection the key may stay blank', () => {
    const saved: Connection = { ...draftFromPreset(preset('anthropic-api')), id: 'abc' };
    render(<Harness presetId="anthropic-api" initial={saved} />);
    expect(screen.getByTestId('credentials-next')).toBeEnabled();
    expect(screen.getByTestId('secret-input')).toHaveAttribute('placeholder', expect.stringMatching(/dejar/i));
  });
});

describe('Credentials — company', () => {
  it('Azure placeholders block Continue until replaced; az login hides the key field', () => {
    render(<Harness presetId="azure-openai" />);
    expect(screen.getByTestId('auth-select')).toHaveValue('az');
    expect(screen.queryByTestId('secret-input')).not.toBeInTheDocument();
    expect(screen.getByTestId('credentials-next')).toBeDisabled(); // https://<resource>...
    fireEvent.change(screen.getByTestId('base-url-input'), {
      target: { value: 'https://acme.openai.azure.com' },
    });
    fireEvent.change(screen.getByTestId('test-model-input'), { target: { value: 'my-gpt41' } });
    expect(screen.getByTestId('credentials-next')).toBeEnabled();
    expect(screen.getByTestId('azure-api-version-input')).toHaveValue('2024-10-21');
  });

  it('token auth shows the key field; none hides it', () => {
    render(<Harness presetId="proxy" />);
    fireEvent.change(screen.getByTestId('base-url-input'), { target: { value: 'https://llm.corp.local/v1' } });
    fireEvent.change(screen.getByTestId('test-model-input'), { target: { value: 'gpt-4.1' } });
    expect(screen.getByTestId('auth-select')).toHaveValue('token');
    expect(screen.getByTestId('credentials-next')).toBeDisabled();
    fireEvent.change(screen.getByTestId('secret-input'), { target: { value: 'tok' } });
    expect(screen.getByTestId('credentials-next')).toBeEnabled();
    fireEvent.change(screen.getByTestId('auth-select'), { target: { value: 'none' } });
    expect(screen.queryByTestId('secret-input')).not.toBeInTheDocument();
    expect(screen.getByTestId('credentials-next')).toBeEnabled();
  });

  it('Advanced: auth header, extra headers and root CA', async () => {
    mockDialog.mockResolvedValueOnce('/Users/me/corp-ca.pem' as never);
    const seen: Connection[] = [];
    function Spy() {
      const [draft, setDraft] = useState<Connection>(draftFromPreset(preset('proxy')));
      seen.push(draft);
      return (
        <Credentials
          preset={preset('proxy')}
          draft={draft}
          secret=""
          onChange={setDraft}
          onSecret={() => {}}
          onBack={() => {}}
          onNext={() => {}}
        />
      );
    }
    render(<Spy />);
    fireEvent.change(screen.getByTestId('auth-header-select'), { target: { value: 'xApiKey' } });
    fireEvent.change(screen.getByTestId('extra-headers-input'), {
      target: { value: 'X-Team: md\nX-Env: prod\nnot-a-header' },
    });
    fireEvent.click(screen.getByTestId('pick-ca'));
    await waitFor(() => expect(screen.getByTestId('ca-path')).toHaveValue('/Users/me/corp-ca.pem'));

    const last = seen[seen.length - 1];
    expect(last.authHeader).toBe('xApiKey');
    expect(last.extraHeaders).toEqual([
      ['X-Team', 'md'],
      ['X-Env', 'prod'],
    ]);
    expect(last.caCertPath).toBe('/Users/me/corp-ca.pem');

    fireEvent.click(screen.getByTestId('clear-ca'));
    expect(screen.getByTestId('ca-path')).toHaveValue('');
  });
});
