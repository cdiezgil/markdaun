import { describe, it, expect, vi, beforeEach } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import { useGraphStore, computeInitialLayout } from './graphStore';

const mockInvoke = vi.mocked(invoke);

beforeEach(() => {
  vi.clearAllMocks();
  useGraphStore.setState({
    nodes: [],
    edges: [],
    isLoading: false,
    error: null,
    showOrphans: true,
    searchQuery: '',
  });
});

// ── TC-08: orphan node ────────────────────────────────────────────────────────
describe('TC-08: loadGraph — orphan node', () => {
  it('TC-08: node with no edges is marked isOrphan=true', async () => {
    mockInvoke.mockResolvedValueOnce({
      nodes: [
        { path: '/vault/orphan.md', name: 'orphan.md', kind: 'md', x: null, y: null },
      ],
      edges: [],
    });

    await useGraphStore.getState().loadGraph('/vault');

    const { nodes } = useGraphStore.getState();
    const rfNode = nodes.find((n) => n.id === '/vault/orphan.md');
    expect(rfNode).toBeDefined();
    const data = rfNode?.data as { isOrphan: boolean };
    expect(data.isOrphan).toBe(true);
  });
});

// ── TC-09: linked nodes ───────────────────────────────────────────────────────
describe('TC-09: loadGraph — linked nodes not orphan', () => {
  it('TC-09: both endpoints of an edge have isOrphan=false', async () => {
    mockInvoke.mockResolvedValueOnce({
      nodes: [
        { path: '/vault/a.md', name: 'a.md', kind: 'md', x: null, y: null },
        { path: '/vault/b.md', name: 'b.md', kind: 'md', x: 50, y: 75 },
      ],
      edges: [{ source: '/vault/a.md', target: '/vault/b.md' }],
    });

    await useGraphStore.getState().loadGraph('/vault');

    const { nodes, edges } = useGraphStore.getState();
    const a = nodes.find((n) => n.id === '/vault/a.md');
    const b = nodes.find((n) => n.id === '/vault/b.md');

    expect((a?.data as { isOrphan: boolean }).isOrphan).toBe(false);
    expect((b?.data as { isOrphan: boolean }).isOrphan).toBe(false);
    expect(edges.length).toBe(1);
    expect(edges[0].source).toBe('/vault/a.md');
    expect(edges[0].target).toBe('/vault/b.md');
  });
});

// ── TC-22: node without saved position gets computedInitialLayout ─────────────
describe('TC-22: computeInitialLayout assigns positions', () => {
  it('TC-22: returns finite x and y for nodes without saved position', async () => {
    mockInvoke.mockResolvedValueOnce({
      nodes: [
        { path: '/vault/a.md', name: 'a.md', kind: 'md', x: null, y: null },
        { path: '/vault/b.md', name: 'b.md', kind: 'md', x: null, y: null },
      ],
      edges: [],
    });

    await useGraphStore.getState().loadGraph('/vault');
    const { nodes } = useGraphStore.getState();

    for (const node of nodes.filter((n) => !n.id.startsWith('orphanGroup'))) {
      expect(Number.isFinite(node.position.x)).toBe(true);
      expect(Number.isFinite(node.position.y)).toBe(true);
    }
  });

  it('TC-22: computeInitialLayout standalone returns a map', () => {
    const positions = computeInitialLayout(
      [{ path: 'a' }, { path: 'b' }, { path: 'c' }],
      [{ source: 'a', target: 'b' }],
    );
    expect(positions.size).toBe(3);
    for (const [, pos] of positions) {
      expect(Number.isFinite(pos.x)).toBe(true);
      expect(Number.isFinite(pos.y)).toBe(true);
    }
  });
});

// ── TC-23: node with saved position respects it ───────────────────────────────
describe('TC-23: saved position respected', () => {
  it('TC-23: node with saved x:50 y:75 gets position {x:50, y:75}', async () => {
    mockInvoke.mockResolvedValueOnce({
      nodes: [
        { path: '/vault/b.md', name: 'b.md', kind: 'md', x: 50, y: 75 },
        { path: '/vault/a.md', name: 'a.md', kind: 'md', x: null, y: null },
      ],
      edges: [{ source: '/vault/a.md', target: '/vault/b.md' }],
    });

    await useGraphStore.getState().loadGraph('/vault');

    const { nodes } = useGraphStore.getState();
    const b = nodes.find((n) => n.id === '/vault/b.md');
    expect(b?.position).toEqual({ x: 50, y: 75 });
  });
});

// ── savePosition ──────────────────────────────────────────────────────────────
describe('savePosition', () => {
  it('invokes save_node_position with correct params', async () => {
    mockInvoke.mockResolvedValueOnce(undefined);
    await useGraphStore.getState().savePosition('/vault', '/vault/a.md', 300, 150);
    expect(mockInvoke).toHaveBeenCalledWith('save_node_position', {
      vaultPath: '/vault',
      filePath: '/vault/a.md',
      x: 300,
      y: 150,
    });
  });
});

// ── setShowOrphans / setSearchQuery ───────────────────────────────────────────
describe('store setters', () => {
  it('setShowOrphans toggles the flag', () => {
    useGraphStore.getState().setShowOrphans(false);
    expect(useGraphStore.getState().showOrphans).toBe(false);
  });

  it('setSearchQuery updates query', () => {
    useGraphStore.getState().setSearchQuery('note');
    expect(useGraphStore.getState().searchQuery).toBe('note');
  });
});

// ── loadGraph error handling ──────────────────────────────────────────────────
describe('loadGraph error handling', () => {
  it('sets error state on invoke rejection', async () => {
    mockInvoke.mockRejectedValueOnce('io_error: permission denied');
    await useGraphStore.getState().loadGraph('/vault');
    expect(useGraphStore.getState().error).toBe('io_error: permission denied');
    expect(useGraphStore.getState().isLoading).toBe(false);
  });
});
