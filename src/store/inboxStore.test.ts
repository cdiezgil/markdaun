import { describe, it, expect, vi, beforeEach } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import { useInboxStore } from './inboxStore';
import type { InboxItem } from '../lib/tauri';

const mockInvoke = vi.mocked(invoke);

const item = (name: string, over: Partial<InboxItem> = {}): InboxItem => ({
  name,
  path: `/v/Entrada/${name}`,
  rel_path: `Entrada/${name}`,
  kind: 'md',
  size: 10,
  added_ms: 1,
  supported: true,
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  useInboxStore.setState({ items: [], selected: [], loading: false, error: null });
});

describe('inboxStore', () => {
  it('load fills the items and the counter', async () => {
    mockInvoke.mockResolvedValueOnce([item('a.md'), item('b.pdf', { kind: 'pdf' })] as never);
    await useInboxStore.getState().load('/v');
    expect(mockInvoke).toHaveBeenCalledWith('inbox_list', { vaultPath: '/v' });
    expect(useInboxStore.getState().items).toHaveLength(2);
  });

  it('load keeps the error and does not throw', async () => {
    mockInvoke.mockRejectedValueOnce('io_error: boom' as never);
    await useInboxStore.getState().load('/v');
    expect(useInboxStore.getState().error).toBe('io_error: boom');
  });

  it('toggle selects and unselects supported items only', () => {
    useInboxStore.setState({ items: [item('a.md'), item('x.docx', { kind: 'other', supported: false })] });
    useInboxStore.getState().toggle('Entrada/a.md');
    useInboxStore.getState().toggle('Entrada/x.docx');
    expect(useInboxStore.getState().selected).toEqual(['Entrada/a.md']);
    useInboxStore.getState().toggle('Entrada/a.md');
    expect(useInboxStore.getState().selected).toEqual([]);
  });

  it('selectAll selects every supported item', () => {
    useInboxStore.setState({ items: [item('a.md'), item('x.docx', { kind: 'other', supported: false }), item('b.txt')] });
    useInboxStore.getState().selectAll();
    expect(useInboxStore.getState().selected).toEqual(['Entrada/a.md', 'Entrada/b.txt']);
  });

  it('discard moves the item out of the list and the selection', async () => {
    useInboxStore.setState({ items: [item('a.md'), item('b.md')], selected: ['Entrada/a.md'] });
    mockInvoke.mockResolvedValueOnce(undefined as never);
    await useInboxStore.getState().discard(item('a.md'), '/v');
    expect(mockInvoke).toHaveBeenCalledWith('inbox_discard', { path: '/v/Entrada/a.md', vaultPath: '/v' });
    expect(useInboxStore.getState().items.map((i) => i.name)).toEqual(['b.md']);
    expect(useInboxStore.getState().selected).toEqual([]);
  });

  describe('clipUrl', () => {
    const summary = {
      path: '/v/Entrada/A.md',
      rel_path: 'Entrada/A.md',
      title: 'A',
      clipped: true,
      failure: null,
      words: 10,
      images_downloaded: 0,
      images_failed: 0,
    };

    it('clips, reloads the list and reports the outcome', async () => {
      mockInvoke.mockImplementation(async (cmd: string) => (cmd === 'inbox_clip_url' ? summary : [item('A.md')]));
      const out = await useInboxStore.getState().clipUrl('https://x.test/a', '/v');
      expect(mockInvoke).toHaveBeenCalledWith('inbox_clip_url', { url: 'https://x.test/a', vaultPath: '/v' });
      expect(out).toEqual(summary);
      expect(useInboxStore.getState().items).toHaveLength(1);
      expect(useInboxStore.getState().clipping).toBe(false);
      expect(useInboxStore.getState().error).toBeNull();
    });

    it('keeps the error for an invalid url and does not throw', async () => {
      mockInvoke.mockRejectedValueOnce('invalid_url' as never);
      const out = await useInboxStore.getState().clipUrl('nope', '/v');
      expect(out).toBeNull();
      expect(useInboxStore.getState().error).toBe('invalid_url');
      expect(useInboxStore.getState().clipping).toBe(false);
    });

    it('is marked busy while clipping', async () => {
      let release: (v: unknown) => void = () => {};
      mockInvoke.mockImplementationOnce(() => new Promise((r) => (release = r)) as never);
      mockInvoke.mockResolvedValue([] as never);
      const p = useInboxStore.getState().clipUrl('https://x.test/a', '/v');
      expect(useInboxStore.getState().clipping).toBe(true);
      release(summary);
      await p;
      expect(useInboxStore.getState().clipping).toBe(false);
    });
  });
});
