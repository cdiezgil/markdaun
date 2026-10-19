import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { invoke } from '@tauri-apps/api/core';
import type { Node as RFNode, Edge } from '@xyflow/react';
import { useGraphStore } from '../../store/graphStore';
import { useEditorStore } from '../../store/editorStore';
import { GraphCanvas } from './GraphCanvas';

const fitView = vi.fn();

vi.mock('@xyflow/react', () => ({
  ReactFlow: ({
    nodes,
    edges,
    onNodesChange,
    onNodeClick,
    onNodeDoubleClick,
    onNodeDragStop,
    onPaneClick,
  }: {
    nodes: RFNode[];
    edges: Edge[];
    onNodesChange?: (c: unknown[]) => void;
    onNodeClick?: (e: React.MouseEvent, n: RFNode) => void;
    onNodeDoubleClick?: (e: React.MouseEvent, n: RFNode) => void;
    onNodeDragStop?: (e: React.MouseEvent, n: RFNode) => void;
    onPaneClick?: () => void;
  }) => (
    <div data-testid="react-flow" onClick={() => onPaneClick?.()}>
      {nodes.map((n) => (
        <div
          key={n.id}
          data-testid={`rf-node-${n.id}`}
          data-type={n.type}
          data-dim={String((n.data as Record<string, unknown>).dim)}
          data-active={String((n.data as Record<string, unknown>).active)}
          data-outside={String((n.data as Record<string, unknown>).outside)}
          style={n.style}
          onClick={(e) => {
            e.stopPropagation();
            onNodeClick?.(e, n);
          }}
          onDoubleClick={(e) => onNodeDoubleClick?.(e, n)}
          onMouseUp={(e) => onNodeDragStop?.(e, { ...n, position: { x: 7, y: 9 } })}
          onMouseDown={() =>
            onNodesChange?.([{ type: 'position', id: n.id, position: { x: 7, y: 9 } }])
          }
        />
      ))}
      {edges.map((e) => (
        <div
          key={e.id}
          data-testid={`rf-edge-${e.id}`}
          data-stroke={(e.style as Record<string, unknown>)?.stroke as string}
        />
      ))}
    </div>
  ),
  ReactFlowProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  Background: () => <div data-testid="rf-background" />,
  BackgroundVariant: { Dots: 'dots' },
  Handle: () => null,
  Position: { Top: 'top' },
  useReactFlow: () => ({ fitView, zoomIn: vi.fn(), zoomOut: vi.fn() }),
  useViewport: () => ({ zoom: 1, x: 0, y: 0 }),
}));

const mockInvoke = vi.mocked(invoke);

const graph = {
  nodes: [
    { path: '/vault/a.md', name: 'a.md', kind: 'md', x: null, y: null, tags: ['ideas'], excerpt: 'hola' },
    { path: '/vault/b.md', name: 'b.md', kind: 'md', x: 10, y: 20, tags: [], excerpt: '' },
    { path: '/vault/Test/o.md', name: 'o.md', kind: 'md', x: null, y: null, tags: [], excerpt: '' },
  ],
  edges: [{ source: '/vault/a.md', target: '/vault/b.md' }],
};

function Where() {
  return <div data-testid="where">{useLocation().pathname}</div>;
}

async function setup(active: string | null = null) {
  useEditorStore.setState({ activeNotePath: active });
  mockInvoke.mockResolvedValueOnce(graph);
  await useGraphStore.getState().loadGraph('/vault');
  render(
    <MemoryRouter>
      <GraphCanvas vaultPath="/vault" />
      <Where />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  useGraphStore.setState({
    model: null,
    nodes: [],
    edges: [],
    tagNodes: [],
    tagEdges: [],
    loadId: 0,
    showLinks: true,
    showTags: false,
    showOrphans: true,
    searchQuery: '',
    selectedPath: null,
    folder: '',
    baseModel: null,
  });
});

describe('GraphCanvas', () => {
  it('renders the container and chrome', async () => {
    await setup();
    expect(screen.getByTestId('graph-canvas')).toBeDefined();
    expect(screen.getByTestId('graph-controls')).toBeDefined();
    expect(screen.getByTestId('graph-zoom')).toBeDefined();
    expect(screen.getByTestId('graph-legend')).toBeDefined();
  });

  it('renders note nodes, link edges and a halo for the named folder', async () => {
    await setup();
    expect(screen.getByTestId('rf-node-/vault/a.md').dataset.type).toBe('graphNode');
    expect(screen.getByTestId('rf-node-halo:Test').dataset.type).toBe('folderHalo');
    expect(screen.getByTestId('rf-edge-/vault/a.md→/vault/b.md')).toBeDefined();
  });

  it('with a folder selected, dims outside neighbours, their edges, and gives them no halo', async () => {
    mockInvoke.mockResolvedValueOnce({
      nodes: [
        { path: '/vault/Test/o.md', name: 'o.md', kind: 'md', x: null, y: null, tags: [], excerpt: '' },
        { path: '/vault/Other/n.md', name: 'n.md', kind: 'md', x: null, y: null, tags: [], excerpt: '' },
        { path: '/vault/far.md', name: 'far.md', kind: 'md', x: null, y: null, tags: [], excerpt: '' },
      ],
      edges: [{ source: '/vault/Test/o.md', target: '/vault/Other/n.md' }],
    });
    await useGraphStore.getState().loadGraph('/vault');
    useGraphStore.getState().setFolder('/vault', 'Test');
    render(
      <MemoryRouter>
        <GraphCanvas vaultPath="/vault" />
      </MemoryRouter>,
    );
    expect(screen.getByTestId('rf-node-/vault/Other/n.md').dataset.outside).toBe('true');
    expect(screen.getByTestId('rf-node-/vault/Test/o.md').dataset.outside).toBe('false');
    expect(screen.queryByTestId('rf-node-/vault/far.md')).toBeNull();
    expect(screen.queryByTestId('rf-node-halo:Other')).toBeNull();
    expect(screen.getByTestId('rf-node-halo:Test')).toBeDefined();
  });

  it('fits the view after a load', async () => {
    await setup();
    await waitFor(() => expect(fitView).toHaveBeenCalled());
  });

  it('hides orphans when Huérfanas is off', async () => {
    await setup();
    fireEvent.click(screen.getByTestId('toggle-orphans'));
    expect(screen.queryByTestId('rf-node-/vault/Test/o.md')).toBeNull();
    expect(screen.queryByTestId('rf-node-halo:Test')).toBeNull();
  });

  it('hides edges when Enlaces is off', async () => {
    await setup();
    fireEvent.click(screen.getByTestId('toggle-links'));
    expect(screen.queryByTestId('rf-edge-/vault/a.md→/vault/b.md')).toBeNull();
  });

  it('adds tag nodes when Etiquetas is on', async () => {
    await setup();
    expect(screen.queryByTestId('rf-node-tag:ideas')).toBeNull();
    fireEvent.click(screen.getByTestId('toggle-tags'));
    expect(screen.getByTestId('rf-node-tag:ideas').dataset.type).toBe('tagNode');
  });

  it('dims non-matching nodes while searching', async () => {
    await setup();
    fireEvent.change(screen.getByTestId('graph-search'), { target: { value: 'a' } });
    expect(screen.getByTestId('rf-node-/vault/a.md').dataset.dim).toBe('false');
    expect(screen.getByTestId('rf-node-/vault/b.md').dataset.dim).toBe('true');
  });

  it('marks the open note and highlights its edges', async () => {
    await setup('/vault/a.md');
    expect(screen.getByTestId('rf-node-/vault/a.md').dataset.active).toBe('true');
    expect(screen.getByTestId('rf-edge-/vault/a.md→/vault/b.md').dataset.stroke).toBe('var(--daun)');
  });

  it('shows the card of the open note and of a clicked node, hides it on pane click', async () => {
    await setup('/vault/a.md');
    expect(screen.getByTestId('graph-note-title').textContent).toBe('a');
    fireEvent.click(screen.getByTestId('rf-node-/vault/b.md'));
    expect(screen.getByTestId('graph-note-title').textContent).toBe('b');
    fireEvent.click(screen.getByTestId('react-flow'));
    expect(screen.queryByTestId('graph-note-card')).toBeNull();
  });

  it('double click opens the note in the editor', async () => {
    await setup();
    fireEvent.doubleClick(screen.getByTestId('rf-node-/vault/a.md'));
    expect(screen.getByTestId('where').textContent).toBe(
      `/editor/${encodeURIComponent('/vault/a.md')}`,
    );
  });

  it('moves a dragged node in the store and persists its position', async () => {
    await setup();
    mockInvoke.mockResolvedValue(undefined);
    fireEvent.mouseDown(screen.getByTestId('rf-node-/vault/a.md'));
    expect(useGraphStore.getState().nodes.find((n) => n.id === '/vault/a.md')!.position).toEqual({
      x: 7,
      y: 9,
    });
    fireEvent.mouseUp(screen.getByTestId('rf-node-/vault/a.md'));
    expect(mockInvoke).toHaveBeenCalledWith('save_node_position', {
      vaultPath: '/vault',
      filePath: '/vault/a.md',
      x: 7,
      y: 9,
    });
  });

  it('does not persist halo or tag drags', async () => {
    await setup();
    fireEvent.mouseUp(screen.getByTestId('rf-node-halo:Test'));
    expect(mockInvoke).not.toHaveBeenCalledWith('save_node_position', expect.anything());
  });
});
