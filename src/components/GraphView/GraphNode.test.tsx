import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { GraphNode } from './GraphNode';
import { TagNode } from './TagNode';
import { FolderHalo } from './FolderHalo';
import type { NodeProps } from '@xyflow/react';

vi.mock('@xyflow/react', () => ({
  Handle: () => null,
  Position: { Top: 'top' },
}));

const base = {
  path: '/vault/a.md',
  label: 'a',
  kind: 'md',
  isOrphan: false,
  diameter: 20,
  backlinks: 1,
  links: 1,
  folder: '',
  tags: [],
  excerpt: '',
};

const props = (data: Record<string, unknown>) => ({ data }) as unknown as NodeProps;

describe('GraphNode', () => {
  it('renders a daun circle sized by diameter with the label underneath', () => {
    render(<GraphNode {...props(base)} />);
    const dot = screen.getByTestId('graph-node-dot');
    expect(dot.style.background).toBe('var(--daun)');
    expect(screen.getByTestId(`graph-node-/vault/a.md`).style.width).toBe('20px');
    expect(screen.getByTestId('graph-node-label').textContent).toBe('a');
  });

  it('draws orphans hollow with amber outline and label', () => {
    render(<GraphNode {...props({ ...base, isOrphan: true })} />);
    expect(screen.getByTestId('graph-node-dot').style.border).toBe('2px solid var(--amber)');
    expect(screen.getByTestId('graph-node-label').style.color).toBe('var(--amber)');
  });

  it('rings the open note in sap and bolds its label', () => {
    render(<GraphNode {...props({ ...base, active: true })} />);
    expect(screen.getByTestId('graph-node-dot').style.boxShadow).toBe('0 0 0 5px var(--sap)');
    const label = screen.getByTestId('graph-node-label');
    expect(label.style.fontWeight).toBe('600');
    expect(label.style.fontSize).toBe('13px');
  });

  it('shows notes outside the selected folder dimmed with a muted label', () => {
    render(<GraphNode {...props({ ...base, outside: true })} />);
    expect(screen.getByTestId('graph-node-/vault/a.md').style.opacity).toBe('0.4');
    expect(screen.getByTestId('graph-node-label').style.color).toBe('var(--ink-muted)');
  });

  it('dims non-matching nodes', () => {
    render(<GraphNode {...props({ ...base, dim: true })} />);
    expect(screen.getByTestId('graph-node-/vault/a.md').style.opacity).toBe('0.2');
  });
});

describe('TagNode', () => {
  it('renders a sap chip with the tag and its count', () => {
    render(<TagNode {...props({ label: 'ideas', count: 3 })} />);
    const chip = screen.getByTestId('tag-node-ideas');
    expect(chip.textContent).toContain('#ideas');
    expect(chip.textContent).toContain('3');
    expect(chip.style.background).toBe('var(--sap)');
  });
});

describe('FolderHalo', () => {
  it('renders the uppercase folder label over a faint halo', () => {
    render(<FolderHalo {...props({ folder: 'Test' })} />);
    const halo = screen.getByTestId('folder-halo-Test');
    expect(halo.textContent).toBe('Test');
    expect(halo.style.pointerEvents).toBe('none');
  });
});
