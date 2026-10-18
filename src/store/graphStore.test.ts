import { describe, it, expect, vi, beforeEach } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import { useGraphStore } from './graphStore';

const mockInvoke = vi.mocked(invoke);

const initial = {
  model: null,
  nodes: [],
  edges: [],
  tagNodes: [],
  tagEdges: [],
  loadId: 0,
  isLoading: false,
  error: null,
  showLinks: true,
  showTags: false,
  showOrphans: true,
  searchQuery: '',
  selectedPath: null,
  folder: '',
  baseModel: null,
};

// Node's built-in localStorage shadows jsdom's; use a deterministic in-memory one.
const memory = new Map<string, string>();
vi.stubGlobal('localStorage', {
  getItem: (k: string) => memory.get(k) ?? null,
  setItem: (k: string, v: string) => void memory.set(k, v),
  removeItem: (k: string) => void memory.delete(k),
  clear: () => memory.clear(),
});

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  useGraphStore.setState(initial);
});

const n = (path: string, extra: Record<string, unknown> = {}) => ({
  path,
  name: path.split('/').pop(),
  kind: 'md',
  x: null,
  y: null,
  tags: [],
  excerpt: '',
  ...extra,
});

describe('loadGraph', () => {
  it('marks a node without edges as orphan and linked nodes as not', async () => {
    mockInvoke.mockResolvedValueOnce({
      nodes: [n('/vault/o.md'), n('/vault/a.md'), n('/vault/b.md', { x: 50, y: 75 })],
      edges: [{ source: '/vault/a.md', target: '/vault/b.md' }],
    });
    await useGraphStore.getState().loadGraph('/vault');
    const { nodes, edges } = useGraphStore.getState();
    const orphan = (id: string) => nodes.find((x) => x.id === id)!.data.isOrphan;
    expect(orphan('/vault/o.md')).toBe(true);
    expect(orphan('/vault/a.md')).toBe(false);
    expect(orphan('/vault/b.md')).toBe(false);
    expect(edges).toHaveLength(1);
    expect(edges[0]).toMatchObject({ source: '/vault/a.md', target: '/vault/b.md' });
  });

  it('computes sizes, backlinks, folder, tags and excerpt', async () => {
    mockInvoke.mockResolvedValueOnce({
      nodes: [
        n('/vault/a.md', { tags: ['x'], excerpt: 'hi' }),
        n('/vault/F/b.md'),
      ],
      edges: [{ source: '/vault/a.md', target: '/vault/F/b.md' }],
    });
    await useGraphStore.getState().loadGraph('/vault');
    const b = useGraphStore.getState().nodes.find((x) => x.id === '/vault/F/b.md')!;
    expect(b.data).toMatchObject({ backlinks: 1, folder: 'F', diameter: 28, label: 'b' });
    const a = useGraphStore.getState().nodes.find((x) => x.id === '/vault/a.md')!;
    expect(a.data).toMatchObject({ links: 1, tags: ['x'], excerpt: 'hi' });
    expect(useGraphStore.getState().tagNodes.map((t) => t.id)).toEqual(['tag:x']);
  });

  it('lays out unsaved nodes at finite positions and keeps saved ones', async () => {
    mockInvoke.mockResolvedValueOnce({
      nodes: [n('/vault/b.md', { x: 50, y: 75 }), n('/vault/a.md')],
      edges: [{ source: '/vault/a.md', target: '/vault/b.md' }],
    });
    await useGraphStore.getState().loadGraph('/vault');
    const { nodes } = useGraphStore.getState();
    expect(nodes.find((x) => x.id === '/vault/b.md')!.position).toEqual({ x: 50, y: 75 });
    const a = nodes.find((x) => x.id === '/vault/a.md')!.position;
    expect(Number.isFinite(a.x) && Number.isFinite(a.y)).toBe(true);
  });

  it('bumps loadId on success', async () => {
    mockInvoke.mockResolvedValueOnce({ nodes: [], edges: [] });
    await useGraphStore.getState().loadGraph('/vault');
    expect(useGraphStore.getState().loadId).toBe(1);
  });

  it('sets error state on invoke rejection', async () => {
    mockInvoke.mockRejectedValueOnce('io_error: permission denied');
    await useGraphStore.getState().loadGraph('/vault');
    expect(useGraphStore.getState().error).toBe('io_error: permission denied');
    expect(useGraphStore.getState().isLoading).toBe(false);
  });

  it('stringifies non-string errors', async () => {
    mockInvoke.mockRejectedValueOnce(new Error('boom'));
    await useGraphStore.getState().loadGraph('/vault');
    expect(useGraphStore.getState().error).toContain('boom');
  });
});

describe('actions', () => {
  it('savePosition invokes save_node_position', async () => {
    mockInvoke.mockResolvedValueOnce(undefined);
    await useGraphStore.getState().savePosition('/vault', '/vault/a.md', 300, 150);
    expect(mockInvoke).toHaveBeenCalledWith('save_node_position', {
      vaultPath: '/vault',
      filePath: '/vault/a.md',
      x: 300,
      y: 150,
    });
  });

  it('savePosition swallows backend errors', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    mockInvoke.mockRejectedValueOnce('nope');
    await expect(useGraphStore.getState().savePosition('/v', '/v/a.md', 1, 2)).resolves.toBeUndefined();
    spy.mockRestore();
  });

  it('moveNode updates note and tag nodes by id', async () => {
    mockInvoke.mockResolvedValueOnce({
      nodes: [n('/vault/a.md', { tags: ['x'] })],
      edges: [],
    });
    await useGraphStore.getState().loadGraph('/vault');
    useGraphStore.getState().moveNode('/vault/a.md', 1, 2);
    useGraphStore.getState().moveNode('tag:x', 3, 4);
    const s = useGraphStore.getState();
    expect(s.nodes[0].position).toEqual({ x: 1, y: 2 });
    expect(s.tagNodes[0].position).toEqual({ x: 3, y: 4 });
  });

  it('setters update filter state and selection', () => {
    const s = useGraphStore.getState();
    s.setShowLinks(false);
    s.setShowTags(true);
    s.setShowOrphans(false);
    s.setSearchQuery('note');
    s.selectNode('/vault/a.md');
    expect(useGraphStore.getState()).toMatchObject({
      showLinks: false,
      showTags: true,
      showOrphans: false,
      searchQuery: 'note',
      selectedPath: '/vault/a.md',
    });
  });
});

describe('folder restriction', () => {
  const graph = {
    nodes: [n('/vault/P/a.md'), n('/vault/out.md'), n('/vault/far.md'), n('/vault/far2.md')],
    edges: [
      { source: '/vault/P/a.md', target: '/vault/out.md' },
      { source: '/vault/far.md', target: '/vault/far2.md' },
    ],
  };

  it('setFolder re-lays out the visible set, persists per vault and bumps loadId', async () => {
    mockInvoke.mockResolvedValueOnce(graph);
    await useGraphStore.getState().loadGraph('/vault');
    const before = useGraphStore.getState().loadId;
    useGraphStore.getState().setFolder('/vault', 'P');
    const s = useGraphStore.getState();
    expect(s.nodes.map((x) => x.id).sort()).toEqual(['/vault/P/a.md', '/vault/out.md']);
    expect(s.model!.outside.has('/vault/out.md')).toBe(true);
    expect(s.loadId).toBe(before + 1);
    expect(localStorage.getItem('markdaun.graph.folder:/vault')).toBe('P');
  });

  it('Bóveda clears the restriction and the stored value', async () => {
    mockInvoke.mockResolvedValueOnce(graph);
    await useGraphStore.getState().loadGraph('/vault');
    useGraphStore.getState().setFolder('/vault', 'P');
    useGraphStore.getState().setFolder('/vault', '');
    expect(useGraphStore.getState().nodes).toHaveLength(4);
    expect(localStorage.getItem('markdaun.graph.folder:/vault')).toBeNull();
  });

  it('restores the stored folder on load', async () => {
    localStorage.setItem('markdaun.graph.folder:/vault', 'P');
    mockInvoke.mockResolvedValueOnce(graph);
    await useGraphStore.getState().loadGraph('/vault');
    expect(useGraphStore.getState().folder).toBe('P');
    expect(useGraphStore.getState().nodes).toHaveLength(2);
  });

  it('falls back to Bóveda when the stored folder no longer exists', async () => {
    localStorage.setItem('markdaun.graph.folder:/vault', 'Gone');
    mockInvoke.mockResolvedValueOnce(graph);
    await useGraphStore.getState().loadGraph('/vault');
    expect(useGraphStore.getState().folder).toBe('');
    expect(useGraphStore.getState().nodes).toHaveLength(4);
  });
});
