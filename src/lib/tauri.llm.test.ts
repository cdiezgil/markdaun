import { describe, it, expect, vi, beforeEach } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import {
  llmDeleteConnection,
  llmDetectCli,
  llmGetActive,
  llmListConnections,
  llmSaveConnection,
  llmSetActive,
  llmValidate,
  llmVerifyModel,
  onLlmValidateProgress,
} from './tauri';
import type { Connection } from './llm/types';

const mockInvoke = vi.mocked(invoke);
const mockListen = vi.mocked(listen);

const draft: Connection = {
  id: '',
  name: 'Office',
  presetId: null,
  engine: 'openAiCompat',
  baseUrl: 'https://x/v1',
  auth: { type: 'apiKey' },
  authHeader: 'bearer',
  extraHeaders: [],
  caCertPath: null,
  azureApiVersion: null,
  models: ['m'],
};

beforeEach(() => {
  vi.clearAllMocks();
  mockInvoke.mockResolvedValue(undefined as never);
});

describe('llm command wrappers send camelCase payloads', () => {
  it('llmValidate', async () => {
    await llmValidate(draft, 'sk');
    expect(mockInvoke).toHaveBeenCalledWith('llm_validate', { draft, secret: 'sk' });
  });

  it('llmVerifyModel', async () => {
    await llmVerifyModel(draft, null, 'tok', 'gpt-4o');
    expect(mockInvoke).toHaveBeenCalledWith('llm_verify_model', {
      draft,
      secret: null,
      token: 'tok',
      model: 'gpt-4o',
    });
  });

  it('llmSaveConnection maps the token to validationToken', async () => {
    await llmSaveConnection(draft, 'sk', 'tok');
    expect(mockInvoke).toHaveBeenCalledWith('llm_save_connection', {
      draft,
      secret: 'sk',
      validationToken: 'tok',
    });
  });

  it('list / delete / active / detect', async () => {
    await llmListConnections();
    expect(mockInvoke).toHaveBeenCalledWith('llm_list_connections');
    await llmDeleteConnection('abc');
    expect(mockInvoke).toHaveBeenCalledWith('llm_delete_connection', { id: 'abc' });
    await llmSetActive('abc', 'm');
    expect(mockInvoke).toHaveBeenCalledWith('llm_set_active', { connectionId: 'abc', model: 'm' });
    await llmGetActive();
    expect(mockInvoke).toHaveBeenCalledWith('llm_get_active');
    await llmDetectCli('cliClaude');
    expect(mockInvoke).toHaveBeenCalledWith('llm_detect_cli', { engine: 'cliClaude' });
  });
});

describe('onLlmValidateProgress', () => {
  it('subscribes to llm-validate-progress and forwards the payload', async () => {
    const unlisten = vi.fn();
    mockListen.mockImplementationOnce(async (_name, cb) => {
      (cb as (e: { payload: unknown }) => void)({ payload: { step: 'reach', status: 'ok' } });
      return unlisten;
    });
    const seen: unknown[] = [];
    const off = await onLlmValidateProgress((e) => seen.push(e));
    expect(mockListen).toHaveBeenCalledWith('llm-validate-progress', expect.any(Function));
    expect(seen).toEqual([{ step: 'reach', status: 'ok' }]);
    expect(off).toBe(unlisten);
  });
});
