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
  llmTestVision,
  llmValidate,
  llmVerifyModel,
  onLlmValidateProgress,
} from './tauri';
import type { Connection } from './llm/types';
import { brainQuery, brainSetConversationScope } from './tauri';

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
  visionModels: [],
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

describe('multimodal wrappers', () => {
  it('llmTestVision sends draft, secret and model', async () => {
    await llmTestVision(draft, 'sk', 'gpt-4o');
    expect(mockInvoke).toHaveBeenCalledWith('llm_test_vision', { draft, secret: 'sk', model: 'gpt-4o' });
  });

  it('brainQuery sends attachments (camelCase) or null', async () => {
    await brainQuery('q', '/v', 'c1', [{ vaultPath: 'a.png' }]);
    expect(mockInvoke).toHaveBeenCalledWith('brain_query', {
      question: 'q',
      vaultPath: '/v',
      conversationId: 'c1',
      attachments: [{ vaultPath: 'a.png' }],
      scope: null,
    });
    await brainQuery('q', '/v');
    expect(mockInvoke).toHaveBeenLastCalledWith('brain_query', {
      question: 'q',
      vaultPath: '/v',
      conversationId: null,
      attachments: null,
      scope: null,
    });
    await brainQuery('q', '/v', undefined, undefined, { kind: 'folder', path: 'M' });
    expect(mockInvoke).toHaveBeenLastCalledWith('brain_query', expect.objectContaining({ scope: { kind: 'folder', path: 'M' } }));
  });

  it('brainSetConversationScope uses camelCase args', async () => {
    await brainSetConversationScope('c1', '/v', { kind: 'vault' });
    expect(mockInvoke).toHaveBeenCalledWith('brain_set_conversation_scope', {
      conversationId: 'c1',
      vaultPath: '/v',
      scope: { kind: 'vault' },
    });
  });
});
