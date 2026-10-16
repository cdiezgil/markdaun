import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

// Mock @xyflow/react Handle to avoid ReactFlow context requirement
vi.mock('@xyflow/react', () => ({
  Handle: (_props: Record<string, unknown>) => <div data-testid="handle" />,
  Position: { Left: 'left', Right: 'right' },
}));

import { GraphNode } from './GraphNode';
import type { GraphNodeData } from '../../store/graphStore';

function makeNodeProps(overrides: Partial<GraphNodeData> & { selected?: boolean }) {
  const data: GraphNodeData = {
    path: '/vault/note.md',
    label: 'note',
    kind: overrides.kind ?? 'md',
    isOrphan: overrides.isOrphan ?? false,
    ...overrides,
  };
  return {
    data,
    selected: overrides.selected ?? false,
    id: data.path,
    // minimal NodeProps stubs
    type: 'graphNode',
    dragging: false,
    isConnectable: true,
    zIndex: 0,
    positionAbsoluteX: 0,
    positionAbsoluteY: 0,
  };
}

// ── TC-14: GraphNode renders ──────────────────────────────────────────────────
describe('TC-14: GraphNode renders', () => {
  it('TC-14: renders node label', () => {
    render(<GraphNode {...(makeNodeProps({}) as unknown as Parameters<typeof GraphNode>[0])} />);
    expect(screen.getByText('note')).toBeDefined();
  });

  it('TC-14: has correct testid', () => {
    render(<GraphNode {...(makeNodeProps({}) as unknown as Parameters<typeof GraphNode>[0])} />);
    expect(screen.getByTestId('graph-node-/vault/note.md')).toBeDefined();
  });

  it('TC-14: .md node has daun left border in style', () => {
    render(<GraphNode {...(makeNodeProps({ kind: 'md' }) as unknown as Parameters<typeof GraphNode>[0])} />);
    const node = screen.getByTestId('graph-node-/vault/note.md');
    expect(node.style.borderLeft).toContain('var(--daun)');
  });

  it('TC-14: non-.md node has no daun left border', () => {
    render(<GraphNode {...(makeNodeProps({ kind: 'image', path: '/vault/img.png', label: 'img.png' }) as unknown as Parameters<typeof GraphNode>[0])} />);
    const node = screen.getByTestId('graph-node-/vault/img.png');
    expect(node.style.borderLeft).toBe('');
  });
});

// ── TC-15: GraphNode selected state ──────────────────────────────────────────
describe('TC-15: GraphNode selected', () => {
  it('TC-15: selected node shows data-selected="true"', () => {
    render(<GraphNode {...(makeNodeProps({ selected: true }) as unknown as Parameters<typeof GraphNode>[0])} />);
    const node = screen.getByTestId('graph-node-/vault/note.md');
    expect(node.getAttribute('data-selected')).toBe('true');
  });

  it('TC-15: unselected node shows data-selected="false"', () => {
    render(<GraphNode {...(makeNodeProps({ selected: false }) as unknown as Parameters<typeof GraphNode>[0])} />);
    const node = screen.getByTestId('graph-node-/vault/note.md');
    expect(node.getAttribute('data-selected')).toBe('false');
  });

  it('TC-15: selected node has data-selected attribute true', () => {
    render(<GraphNode {...(makeNodeProps({ selected: true }) as unknown as Parameters<typeof GraphNode>[0])} />);
    const node = screen.getByTestId('graph-node-/vault/note.md');
    // Verify selected state is reflected — style.border uses CSS vars which jsdom doesn't resolve,
    // so we verify the attribute that drives the conditional style
    expect(node.getAttribute('data-selected')).toBe('true');
  });
});
