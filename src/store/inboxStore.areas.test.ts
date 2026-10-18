import { describe, it, expect, vi, beforeEach } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import { useInboxStore } from './inboxStore';

const mockInvoke = vi.mocked(invoke);

beforeEach(() => {
  vi.clearAllMocks();
  useInboxStore.setState({ areas: [], lastArea: null });
});

describe('inboxStore areas', () => {
  it('loads the areas and the last used one', async () => {
    mockInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === 'inbox_list_areas') return ['Mutua', 'Personal'];
      if (cmd === 'inbox_get_last_area') return 'Personal';
      return undefined;
    });
    await useInboxStore.getState().loadAreas('/v');
    const s = useInboxStore.getState();
    expect(s.areas).toEqual(['Mutua', 'Personal']);
    expect(s.lastArea).toBe('Personal');
  });

  it('keeps the root ("") as a valid last area and null when never chosen', async () => {
    mockInvoke.mockImplementation(async (cmd: string) => (cmd === 'inbox_list_areas' ? [] : cmd === 'inbox_get_last_area' ? '' : undefined));
    await useInboxStore.getState().loadAreas('/v');
    expect(useInboxStore.getState().lastArea).toBe('');
    mockInvoke.mockImplementation(async (cmd: string) => (cmd === 'inbox_list_areas' ? [] : null));
    await useInboxStore.getState().loadAreas('/v');
    expect(useInboxStore.getState().lastArea).toBeNull();
  });

  it('remembers the chosen area', async () => {
    mockInvoke.mockResolvedValue(undefined as never);
    await useInboxStore.getState().rememberArea('/v', 'Mutua');
    expect(mockInvoke).toHaveBeenCalledWith('inbox_set_last_area', { vaultPath: '/v', area: 'Mutua' });
    expect(useInboxStore.getState().lastArea).toBe('Mutua');
  });
});
