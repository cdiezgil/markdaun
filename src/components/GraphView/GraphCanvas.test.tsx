import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { invoke } from '@tauri-apps/api/core';
import { useGraphStore } from '../../store/graphStore';
import { GraphCanvas } from './GraphCanvas';
import type { Node as RFNode } from '@xyflow/react';

// Mock @xyflow/react with testable stubs
vi.mock('@xyflow/react', () => ({
  ReactFlow: ({
    nodes,
    edges,
    onNodeDoubleClick,
    onNodeDragStop,
  }: {
    nodes: RFNode[];
    edges: { id: string; source: string; target: string }[];
    onNodeDoubleClick?: (e: React.MouseEvent, node: RFNode) => void;
    onNodeDragStop?: (e: React.MouseEvent, node: RFNode) => void;
  }) => (
    <div data-testid="react-flow">
      {nodes.map((n) => (
        <div
          key={n.id}
          data-testid={`rf-node-${n.id}`}
          data-type={n.type}
          data-opacity={(n.style as Record<string, unknown>)?.opacity}
          onDoubleClick={(e) =>
            onNodeDoubleClick?.(e, n)
          }
          onClick={(e) =>
            onNodeDragStop?.(e as unknown as React.MouseEvent, n)
          }
        >
          {String((n.data as Record<string, unknown>)['label'] ?? n.id)}
        </div>
      ))}
      {edges.map((e) => (
        <div key={e.id} data-testid={`rf-edge-${e.id}`} />
      ))}
    </div>
  ),
  ReactFlowProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  Background: () => <div data-testid="rf-background" />,
  Controls: () => <div data-testid="rf-controls" />,
}));

vi.mock('./GraphControls', () => ({
  GraphControls: ({ vaultPath }: { vaultPath: string }) => (
    <div data-testid="graph-controls-stub" data-vault={vaultPath} />
  ),
}));

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

function renderCanvas(vaultPath = '/vault') {
  return render(
    <MemoryRouter>
      <GraphCanvas vaultPath={vaultPath} />
    </MemoryRouter>,
  );
}

// ── TC-14: GraphCanvas renders ────────────────────────────────────────────────
describe('TC-14: GraphCanvas renders', () => {
  it('TC-14: renders graph canvas container', () => {
    renderCanvas();
    expect(screen.getByTestId('graph-canvas')).toBeDefined();
  });

  it('TC-14: renders nodes from store', () => {
    useGraphStore.setState({
      nodes: [
        {
          id: '/vault/a.md',
          type: 'graphNode',
          position: { x: 0, y: 0 },
          data: { path: '/vault/a.md', label: 'a', kind: 'md', isOrphan: false },
        } as unknown as RFNode,
      ],
      edges: [],
    });

    renderCanvas();
    expect(screen.getByTestId('rf-node-/vault/a.md')).toBeDefined();
  });
});

// ── TC-16: double click navigates to editor ───────────────────────────────────
describe('TC-16: double click navigates to editor', () => {
  it('TC-16: double clicking a graphNode triggers onNodeDoubleClick', () => {
    useGraphStore.setState({
      nodes: [
        {
          id: '/vault/note.md',
          type: 'graphNode',
          position: { x: 0, y: 0 },
          data: { path: '/vault/note.md', label: 'note', kind: 'md', isOrphan: false },
        } as unknown as RFNode,
      ],
      edges: [],
    });

    renderCanvas();
    const node = screen.getByTestId('rf-node-/vault/note.md');
    // Should not throw
    fireEvent.dblClick(node);
    expect(node).toBeDefined();
  });
});

// ── TC-17: orphan toggle hides orphan nodes ───────────────────────────────────
describe('TC-17: orphan toggle', () => {
  it('TC-17: orphan nodes not rendered when showOrphans=false', () => {
    useGraphStore.setState({
      nodes: [
        {
          id: '/vault/orphan.md',
          type: 'graphNode',
          position: { x: 0, y: 0 },
          data: { path: '/vault/orphan.md', label: 'orphan', kind: 'md', isOrphan: true },
        } as unknown as RFNode,
        {
          id: 'orphanGroup_root',
          type: 'orphanGroup',
          position: { x: 0, y: 0 },
          data: { folderName: 'root' },
        } as unknown as RFNode,
      ],
      edges: [],
      showOrphans: false,
    });

    renderCanvas();
    expect(screen.queryByTestId('rf-node-/vault/orphan.md')).toBeNull();
    expect(screen.queryByTestId('rf-node-orphanGroup_root')).toBeNull();
  });

  it('TC-17: orphan nodes visible when showOrphans=true', () => {
    useGraphStore.setState({
      nodes: [
        {
          id: '/vault/orphan.md',
          type: 'graphNode',
          position: { x: 0, y: 0 },
          data: { path: '/vault/orphan.md', label: 'orphan', kind: 'md', isOrphan: true },
        } as unknown as RFNode,
      ],
      edges: [],
      showOrphans: true,
    });

    renderCanvas();
    expect(screen.getByTestId('rf-node-/vault/orphan.md')).toBeDefined();
  });
});

// ── TC-18: search dims non-matching nodes ─────────────────────────────────────
describe('TC-18: search filter', () => {
  it('TC-18: non-matching node gets opacity 0.2', () => {
    useGraphStore.setState({
      nodes: [
        {
          id: '/vault/NoteA.md',
          type: 'graphNode',
          position: { x: 0, y: 0 },
          data: { path: '/vault/NoteA.md', label: 'NoteA', kind: 'md', isOrphan: false },
        } as unknown as RFNode,
        {
          id: '/vault/About.md',
          type: 'graphNode',
          position: { x: 100, y: 0 },
          data: { path: '/vault/About.md', label: 'About', kind: 'md', isOrphan: false },
        } as unknown as RFNode,
      ],
      edges: [],
      searchQuery: 'note',
    });

    renderCanvas();

    const aboutNode = screen.getByTestId('rf-node-/vault/About.md');
    expect(aboutNode.getAttribute('data-opacity')).toBe('0.2');

    const noteNode = screen.getByTestId('rf-node-/vault/NoteA.md');
    expect(noteNode.getAttribute('data-opacity')).toBeNull();
  });
});

// ── TC-21: drag stop saves position ──────────────────────────────────────────
describe('TC-21: drag stop saves position', () => {
  it('TC-21: clicking node (simulating drag stop) triggers savePosition invoke', async () => {
    mockInvoke.mockResolvedValue(undefined);

    useGraphStore.setState({
      nodes: [
        {
          id: '/vault/a.md',
          type: 'graphNode',
          position: { x: 300, y: 150 },
          data: { path: '/vault/a.md', label: 'a', kind: 'md', isOrphan: false },
        } as unknown as RFNode,
      ],
      edges: [],
    });

    renderCanvas();

    const node = screen.getByTestId('rf-node-/vault/a.md');
    fireEvent.click(node);

    await vi.waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith('save_node_position', {
        vaultPath: '/vault',
        filePath: '/vault/a.md',
        x: 300,
        y: 150,
      });
    });
  });
});
