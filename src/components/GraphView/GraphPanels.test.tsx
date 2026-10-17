import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { invoke } from '@tauri-apps/api/core';
import { useGraphStore, type GraphNodeData } from '../../store/graphStore';
import { useBrainStore } from '../../store/brainStore';
import { GraphFilterPanel } from './GraphFilterPanel';
import { GraphNoteCard } from './GraphNoteCard';
import { GraphZoom } from './GraphZoom';

const zoomIn = vi.fn();
const zoomOut = vi.fn();
const fitView = vi.fn();
vi.mock('@xyflow/react', () => ({
  useReactFlow: () => ({ zoomIn, zoomOut, fitView }),
  useViewport: () => ({ zoom: 1.25, x: 0, y: 0 }),
}));

const mockInvoke = vi.mocked(invoke);

beforeEach(() => {
  vi.clearAllMocks();
  useGraphStore.setState({ showLinks: true, showTags: false, showOrphans: true, searchQuery: '' });
});

describe('GraphFilterPanel', () => {
  it('toggles the three filters and reflects them with aria-pressed', () => {
    render(<GraphFilterPanel vaultPath="/vault" />);
    expect(screen.getByTestId('toggle-links').getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByTestId('toggle-tags').getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(screen.getByTestId('toggle-tags'));
    fireEvent.click(screen.getByTestId('toggle-links'));
    fireEvent.click(screen.getByTestId('toggle-orphans'));
    const s = useGraphStore.getState();
    expect([s.showTags, s.showLinks, s.showOrphans]).toEqual([true, false, false]);
  });

  it('active chips use the mark background and daun border', () => {
    render(<GraphFilterPanel vaultPath="/vault" />);
    const chip = screen.getByTestId('toggle-links');
    expect(chip.style.background).toBe('var(--mark)');
    expect(chip.style.border).toBe('1px solid var(--daun)');
  });

  it('writes the search query to the store', () => {
    render(<GraphFilterPanel vaultPath="/vault" />);
    fireEvent.change(screen.getByTestId('graph-search'), { target: { value: 'nota' } });
    expect(useGraphStore.getState().searchQuery).toBe('nota');
  });

  it('reload re-fetches the graph', () => {
    mockInvoke.mockResolvedValue({ nodes: [], edges: [] });
    render(<GraphFilterPanel vaultPath="/vault" />);
    fireEvent.click(screen.getByTestId('reload-graph'));
    expect(mockInvoke).toHaveBeenCalledWith('get_vault_graph', { vaultPath: '/vault' });
  });
});

describe('GraphZoom', () => {
  it('shows the zoom percentage and drives zoom and fit', () => {
    render(<GraphZoom />);
    expect(screen.getByTestId('graph-zoom-level').textContent).toBe('125%');
    fireEvent.click(screen.getByLabelText('Acercar'));
    fireEvent.click(screen.getByLabelText('Alejar'));
    fireEvent.click(screen.getByLabelText('Ajustar a la vista'));
    expect(zoomIn).toHaveBeenCalled();
    expect(zoomOut).toHaveBeenCalled();
    expect(fitView).toHaveBeenCalled();
  });
});

function Where() {
  return <div data-testid="where">{useLocation().pathname}</div>;
}

const note: GraphNodeData = {
  path: '/vault/Test/a.md',
  label: 'Primera nota',
  kind: 'md',
  isOrphan: false,
  diameter: 20,
  backlinks: 1,
  links: 4,
  folder: 'Test',
  tags: [],
  excerpt: 'Buenas',
};

function renderCard(node: GraphNodeData) {
  return render(
    <MemoryRouter>
      <GraphNoteCard node={node} />
      <Where />
    </MemoryRouter>,
  );
}

describe('GraphNoteCard', () => {
  it('shows folder, title, excerpt and counters with plurals', () => {
    renderCard(note);
    const card = screen.getByTestId('graph-note-card');
    expect(card.textContent).toContain('Test');
    expect(screen.getByTestId('graph-note-title').textContent).toBe('Primera nota');
    expect(screen.getByTestId('graph-note-excerpt').textContent).toBe('Buenas');
    expect(card.textContent).toContain('4 enlaces');
    expect(card.textContent).toContain('1 backlink');
    expect(card.textContent).not.toContain('1 backlinks');
  });

  it('Abrir nota navigates to the editor', () => {
    renderCard(note);
    fireEvent.click(screen.getByTestId('graph-note-open'));
    expect(screen.getByTestId('where').textContent).toBe(
      `/editor/${encodeURIComponent(note.path)}`,
    );
  });

  it('Preguntar hands a prompt to Brain and opens it', () => {
    useBrainStore.setState({ pendingPrompt: null });
    renderCard(note);
    fireEvent.click(screen.getByTestId('graph-note-ask'));
    expect(useBrainStore.getState().pendingPrompt).toMatchObject({
      text: 'Háblame de [[Primera nota]]',
      send: false,
    });
    expect(screen.getByTestId('where').textContent).toBe('/brain');
  });

  it('attachments open the preview and cannot be asked about', () => {
    renderCard({ ...note, kind: 'pdf', excerpt: '' });
    expect(screen.queryByTestId('graph-note-ask')).toBeNull();
    expect(screen.queryByTestId('graph-note-excerpt')).toBeNull();
    fireEvent.click(screen.getByTestId('graph-note-open'));
    expect(screen.getByTestId('where').textContent).toBe(
      `/preview/${encodeURIComponent(note.path)}`,
    );
  });

  it('falls back to "Bóveda" for root notes', () => {
    renderCard({ ...note, folder: '' });
    expect(screen.getByTestId('graph-note-card').textContent).toContain('Bóveda');
  });
});
