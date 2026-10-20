import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { invoke } from '@tauri-apps/api/core';
import { useVaultStore } from '../store/vaultStore';
import { useGraphStore } from '../store/graphStore';
import { GraphView } from './GraphView';

vi.mock('../components/GraphView/GraphCanvas', () => ({
  GraphCanvas: ({ vaultPath }: { vaultPath: string }) => (
    <div data-testid="graph-canvas-stub" data-vault={vaultPath} />
  ),
}));

const mockInvoke = vi.mocked(invoke);

beforeEach(() => {
  vi.clearAllMocks();
  useVaultStore.setState({ vaultPath: null, tree: [], isLoading: false, error: null });
  useGraphStore.setState({
    model: null,
    nodes: [],
    edges: [],
    isLoading: false,
    error: null,
    showOrphans: true,
    searchQuery: '',
  });
});

function renderGraphView() {
  return render(
    <MemoryRouter>
      <GraphView />
    </MemoryRouter>,
  );
}

// ── TC-14: GraphView renders ──────────────────────────────────────────────────
describe('TC-14: GraphView renders', () => {
  it('TC-14: shows placeholder when no vault configured', () => {
    renderGraphView();
    expect(screen.getByTestId('graph-placeholder')).toBeDefined();
  });

  it('TC-14: renders GraphCanvas when vaultPath is set', async () => {
    useVaultStore.setState({ vaultPath: '/vault' });
    mockInvoke.mockResolvedValue({ nodes: [], edges: [] });

    renderGraphView();

    await waitFor(() => {
      expect(screen.getByTestId('graph-canvas-stub')).toBeDefined();
    });
  });

  it('TC-14: GraphCanvas receives correct vaultPath', async () => {
    useVaultStore.setState({ vaultPath: '/my-vault' });
    mockInvoke.mockResolvedValue({ nodes: [], edges: [] });

    renderGraphView();

    await waitFor(() => {
      const canvas = screen.getByTestId('graph-canvas-stub');
      expect(canvas.getAttribute('data-vault')).toBe('/my-vault');
    });
  });
});

// ── TC-20: reload loads graph ─────────────────────────────────────────────────
describe('TC-20: GraphView loads graph on mount', () => {
  it('TC-20: calls loadGraph (invoke get_vault_graph) on mount', async () => {
    useVaultStore.setState({ vaultPath: '/vault' });
    mockInvoke.mockResolvedValue({ nodes: [], edges: [] });

    renderGraphView();

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith('get_vault_graph', {
        vaultPath: '/vault',
      });
    });
  });
});

// ── TC-59a..TC-59d: graph loading spinner ─────────────────────────────────────
describe('TC-59: graph loading spinner', () => {
  it('TC-59a: shows spinner when vaultPath is set and isLoading is true', () => {
    useVaultStore.setState({ vaultPath: '/vault' });
    useGraphStore.setState({ isLoading: true });
    mockInvoke.mockResolvedValue({ nodes: [], edges: [] });

    renderGraphView();

    expect(screen.getByTestId('graph-loading-spinner')).toBeDefined();
  });

  it('TC-59b: does NOT show spinner when isLoading is false (after load completes)', async () => {
    useVaultStore.setState({ vaultPath: '/vault' });
    mockInvoke.mockResolvedValue({ nodes: [], edges: [] });

    renderGraphView();

    // loadGraph sets isLoading: true then resolves; wait for it to go false.
    await waitFor(() => {
      expect(screen.queryByTestId('graph-loading-spinner')).toBeNull();
    });
    expect(screen.getByTestId('graph-canvas-stub')).toBeDefined();
  });

  it('TC-59c: does NOT show spinner when vaultPath is null (placeholder shown instead)', () => {
    useVaultStore.setState({ vaultPath: null });
    useGraphStore.setState({ isLoading: true });

    renderGraphView();

    expect(screen.queryByTestId('graph-loading-spinner')).toBeNull();
    expect(screen.getByTestId('graph-placeholder')).toBeDefined();
  });

  it('TC-59d: spinner disappears when isLoading transitions from true to false', async () => {
    useVaultStore.setState({ vaultPath: '/vault' });
    useGraphStore.setState({ isLoading: true });
    mockInvoke.mockResolvedValue({ nodes: [], edges: [] });

    renderGraphView();
    expect(screen.getByTestId('graph-loading-spinner')).toBeDefined();

    // Simulate load completion
    useGraphStore.setState({ isLoading: false });

    await waitFor(() => {
      expect(screen.queryByTestId('graph-loading-spinner')).toBeNull();
    });
  });
});
