import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { invoke } from '@tauri-apps/api/core';
import { useGraphStore } from '../../store/graphStore';
import { GraphControls } from './GraphControls';

vi.mock('@xyflow/react', () => ({
  Controls: () => <div data-testid="rf-controls" />,
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

// ── TC-17: toggle orphans ──────────────────────────────────────────────────────
describe('TC-17: GraphControls — toggle orphans', () => {
  it('TC-17: renders toggle-orphans button', () => {
    render(<GraphControls vaultPath="/vault" />);
    expect(screen.getByTestId('toggle-orphans')).toBeDefined();
  });

  it('TC-17: clicking toggle-orphans sets showOrphans to false', () => {
    render(<GraphControls vaultPath="/vault" />);
    fireEvent.click(screen.getByTestId('toggle-orphans'));
    expect(useGraphStore.getState().showOrphans).toBe(false);
  });

  it('TC-17: clicking toggle-orphans again sets showOrphans back to true', () => {
    useGraphStore.setState({ showOrphans: false });
    render(<GraphControls vaultPath="/vault" />);
    fireEvent.click(screen.getByTestId('toggle-orphans'));
    expect(useGraphStore.getState().showOrphans).toBe(true);
  });
});

// ── TC-18: search input ───────────────────────────────────────────────────────
describe('TC-18: GraphControls — search', () => {
  it('TC-18: renders search input', () => {
    render(<GraphControls vaultPath="/vault" />);
    expect(screen.getByTestId('graph-search')).toBeDefined();
  });

  it('TC-18: typing in search updates searchQuery in store', () => {
    render(<GraphControls vaultPath="/vault" />);
    const input = screen.getByTestId('graph-search');
    fireEvent.change(input, { target: { value: 'note' } });
    expect(useGraphStore.getState().searchQuery).toBe('note');
  });
});

// ── TC-19: zoom controls ──────────────────────────────────────────────────────
describe('TC-19: GraphControls — RF controls', () => {
  it('TC-19: renders RF Controls component', () => {
    render(<GraphControls vaultPath="/vault" />);
    expect(screen.getByTestId('rf-controls')).toBeDefined();
  });
});

// ── TC-20: reload button ──────────────────────────────────────────────────────
describe('TC-20: GraphControls — reload', () => {
  it('TC-20: renders reload-graph button', () => {
    render(<GraphControls vaultPath="/vault" />);
    expect(screen.getByTestId('reload-graph')).toBeDefined();
  });

  it('TC-20: clicking reload calls loadGraph (invokes get_vault_graph)', async () => {
    mockInvoke.mockResolvedValue({ nodes: [], edges: [] });
    render(<GraphControls vaultPath="/vault" />);
    fireEvent.click(screen.getByTestId('reload-graph'));
    await vi.waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith('get_vault_graph', {
        vault_path: '/vault',
      });
    });
  });
});
