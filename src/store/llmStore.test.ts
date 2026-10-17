import { describe, it, expect, vi, beforeEach } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import { useLlmStore } from './llmStore';
import type { Connection } from '../lib/llm/types';

const mockInvoke = vi.mocked(invoke);

const conn = (id: string): Connection => ({
  id,
  name: `C${id}`,
  presetId: null,
  engine: 'openAiCompat',
  baseUrl: 'https://x',
  auth: { type: 'none' },
  authHeader: 'bearer',
  extraHeaders: [],
  caCertPath: null,
  azureApiVersion: null,
  models: ['m1', 'm2'],
  visionModels: [],
});

beforeEach(() => {
  vi.clearAllMocks();
  useLlmStore.setState({
    connections: [],
    active: null,
    loaded: false,
    error: null,
    wizardOpen: false,
    editing: null,
  });
});

describe('load', () => {
  it('fills connections and active selection', async () => {
    mockInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === 'llm_list_connections') return [conn('a')];
      if (cmd === 'llm_get_active') return { connectionId: 'a', model: 'm1' };
      return undefined;
    });
    await useLlmStore.getState().load();
    const s = useLlmStore.getState();
    expect(s.loaded).toBe(true);
    expect(s.connections).toHaveLength(1);
    expect(s.active).toEqual({ connectionId: 'a', model: 'm1' });
  });

  it('tolerates empty responses', async () => {
    mockInvoke.mockResolvedValue(undefined as never);
    await useLlmStore.getState().load();
    const s = useLlmStore.getState();
    expect(s.loaded).toBe(true);
    expect(s.connections).toEqual([]);
    expect(s.active).toBeNull();
  });

  it('records a human error when loading fails', async () => {
    mockInvoke.mockRejectedValue({ kind: 'Storage', detail: 'disk' });
    await useLlmStore.getState().load();
    const s = useLlmStore.getState();
    expect(s.loaded).toBe(true);
    expect(s.error).toMatch(/guardar/i);
  });
});

describe('setActive', () => {
  it('persists through llm_set_active and updates state', async () => {
    mockInvoke.mockResolvedValueOnce({ connectionId: 'a', model: 'm2' });
    await useLlmStore.getState().setActive('a', 'm2');
    expect(mockInvoke).toHaveBeenCalledWith('llm_set_active', { connectionId: 'a', model: 'm2' });
    expect(useLlmStore.getState().active).toEqual({ connectionId: 'a', model: 'm2' });
  });

  it('keeps the previous selection and reports the error on failure', async () => {
    useLlmStore.setState({ active: { connectionId: 'a', model: 'm1' } });
    mockInvoke.mockRejectedValueOnce({ kind: 'ModelNotFound' });
    await useLlmStore.getState().setActive('a', 'zzz');
    expect(useLlmStore.getState().active).toEqual({ connectionId: 'a', model: 'm1' });
    expect(useLlmStore.getState().error).toMatch(/modelo/i);
  });
});

describe('deleteConnection', () => {
  it('deletes then reloads', async () => {
    mockInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === 'llm_list_connections') return [];
      return undefined;
    });
    await useLlmStore.getState().deleteConnection('a');
    expect(mockInvoke).toHaveBeenCalledWith('llm_delete_connection', { id: 'a' });
    expect(mockInvoke).toHaveBeenCalledWith('llm_list_connections');
  });
});

describe('wizard state', () => {
  it('opens for a new connection, for editing, and closes', () => {
    useLlmStore.getState().openWizard();
    expect(useLlmStore.getState().wizardOpen).toBe(true);
    expect(useLlmStore.getState().editing).toBeNull();

    useLlmStore.getState().openWizard(conn('a'));
    expect(useLlmStore.getState().editing?.id).toBe('a');

    useLlmStore.getState().closeWizard();
    expect(useLlmStore.getState().wizardOpen).toBe(false);
    expect(useLlmStore.getState().editing).toBeNull();
  });
});
