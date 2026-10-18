import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { invoke } from '@tauri-apps/api/core';
import { InboxView } from './InboxView';
import { useVaultStore } from '../../store/vaultStore';
import { useInboxStore } from '../../store/inboxStore';
import { useBrainStore } from '../../store/brainStore';
import { useLlmStore } from '../../store/llmStore';
import type { InboxItem } from '../../lib/tauri';

const mockInvoke = vi.mocked(invoke);

const item = (name: string, kind: InboxItem['kind'], over: Partial<InboxItem> = {}): InboxItem => ({
  name,
  path: `/v/Entrada/${name}`,
  rel_path: `Entrada/${name}`,
  kind,
  size: 2048,
  added_ms: Date.UTC(2026, 9, 18, 12),
  supported: kind !== 'other',
  ...over,
});

const ITEMS = [item('acta.md', 'md'), item('foto.png', 'image'), item('hoja.xlsx', 'other')];

function renderView() {
  return render(
    <MemoryRouter initialEntries={['/inbox']}>
      <Routes>
        <Route path="/inbox" element={<InboxView />} />
        <Route path="/brain" element={<div data-testid="brain-route" />} />
      </Routes>
    </MemoryRouter>,
  );
}

const digest = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  digest.mockResolvedValue(undefined);
  useVaultStore.setState({ vaultPath: '/v' });
  useInboxStore.setState({ items: [], selected: [], loading: false, error: null });
  useBrainStore.setState({ digest });
  useLlmStore.setState({ loaded: true, active: { connectionId: 'k', model: 'm' }, load: vi.fn() } as never);
  mockInvoke.mockImplementation(async (cmd: string) => (cmd === 'inbox_list' ? ITEMS : undefined));
});

describe('InboxView', () => {
  it('lists the items with name, type, size and date', async () => {
    renderView();
    expect(await screen.findByText('acta.md')).toBeInTheDocument();
    expect(screen.getByText('foto.png')).toBeInTheDocument();
    expect(screen.getAllByText(/2 KB/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/18\/10\/2026/).length).toBeGreaterThan(0);
  });

  it('marks unsupported types and offers only Descartar for them', async () => {
    renderView();
    const row = await screen.findByTestId('inbox-item-hoja.xlsx');
    expect(row).toHaveTextContent('formato no soportado todavía');
    expect(screen.queryByTestId('digest-hoja.xlsx')).toBeNull();
    expect(screen.getByTestId('discard-hoja.xlsx')).toBeInTheDocument();
    expect(screen.getByTestId('select-hoja.xlsx')).toBeDisabled();
  });

  it('Digerir digests that item and goes to the Brain', async () => {
    renderView();
    fireEvent.click(await screen.findByTestId('digest-acta.md'));
    await waitFor(() => expect(screen.getByTestId('brain-route')).toBeInTheDocument());
    expect(digest).toHaveBeenCalledWith([expect.objectContaining({ rel_path: 'Entrada/acta.md' })], '/v');
  });

  it('Digerir seleccionados digests the selection in order', async () => {
    renderView();
    fireEvent.click(await screen.findByTestId('select-acta.md'));
    fireEvent.click(screen.getByTestId('select-foto.png'));
    fireEvent.click(screen.getByTestId('digest-selected'));
    await waitFor(() => expect(digest).toHaveBeenCalled());
    expect(digest.mock.calls[0][0].map((i: InboxItem) => i.name)).toEqual(['acta.md', 'foto.png']);
  });

  it('hides the bulk action until something is selected', async () => {
    renderView();
    await screen.findByText('acta.md');
    expect(screen.queryByTestId('digest-selected')).toBeNull();
  });

  it('Descartar sends the item to the trash and removes it from the list', async () => {
    renderView();
    fireEvent.click(await screen.findByTestId('discard-acta.md'));
    await waitFor(() => expect(screen.queryByText('acta.md')).toBeNull());
    expect(mockInvoke).toHaveBeenCalledWith('inbox_discard', { path: '/v/Entrada/acta.md', vaultPath: '/v' });
  });

  it('shows an empty state', async () => {
    mockInvoke.mockImplementation(async () => []);
    renderView();
    expect(await screen.findByText(/la entrada está vacía/i)).toBeInTheDocument();
  });

  it('asks for an AI connection when none is active', async () => {
    useLlmStore.setState({ loaded: true, active: null } as never);
    renderView();
    expect(await screen.findByText(/conexión de ia/i)).toBeInTheDocument();
    expect(screen.getByTestId('digest-acta.md')).toBeDisabled();
  });
});
