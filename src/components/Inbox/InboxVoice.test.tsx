import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { invoke } from '@tauri-apps/api/core';
import { InboxView } from './InboxView';
import { useVaultStore } from '../../store/vaultStore';
import { useInboxStore } from '../../store/inboxStore';
import { useLlmStore } from '../../store/llmStore';
import type { InboxItem, VoiceInfo } from '../../lib/tauri';

const mockInvoke = vi.mocked(invoke);

const audio = (name: string, voice: VoiceInfo): InboxItem => ({
  name,
  path: `/v/Entrada/${name}`,
  rel_path: `Entrada/${name}`,
  kind: 'audio',
  size: 4096,
  added_ms: Date.UTC(2026, 9, 18, 12),
  supported: false,
  voice,
});

const note: InboxItem = {
  name: 'Nota de voz.md',
  path: '/v/Entrada/Nota de voz.md',
  rel_path: 'Entrada/Nota de voz.md',
  kind: 'md',
  size: 900,
  added_ms: Date.UTC(2026, 9, 18, 12),
  supported: true,
};

function withItems(items: InboxItem[]) {
  mockInvoke.mockImplementation(async (cmd: string) => {
    if (cmd === 'inbox_list') return items;
    if (cmd === 'inbox_list_areas') return [];
    return undefined;
  });
}

function renderView() {
  return render(
    <MemoryRouter>
      <InboxView />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  useVaultStore.setState({ vaultPath: '/v' });
  useInboxStore.setState({ items: [], selected: [], loading: false, error: null, areas: [], lastArea: null });
  useLlmStore.setState({ loaded: true, active: { connectionId: 'k', model: 'm' }, load: vi.fn() } as never);
});

describe('InboxView — voice recordings', () => {
  it('shows "Transcribiendo…" and offers neither Digerir nor selection', async () => {
    withItems([audio('a.m4a', { state: 'transcribing', detail: null, progress: null })]);
    renderView();
    const row = await screen.findByTestId('inbox-item-a.m4a');
    expect(row).toHaveTextContent('Transcribiendo…');
    expect(row).toHaveTextContent('Audio');
    expect(row).not.toHaveTextContent('formato no soportado');
    expect(screen.queryByTestId('digest-a.m4a')).toBeNull();
    expect(screen.queryByTestId('retry-a.m4a')).toBeNull();
    expect(screen.getByTestId('select-a.m4a')).toBeDisabled();
    expect(screen.getByTestId('discard-a.m4a')).toBeInTheDocument();
  });

  it('shows the model download progress', async () => {
    withItems([audio('a.m4a', { state: 'downloading', detail: null, progress: 0.25 })]);
    renderView();
    expect(await screen.findByTestId('inbox-item-a.m4a')).toHaveTextContent('Descargando el modelo de voz… 25 %');
  });

  it('a failed transcription says so and Reintentar starts it again', async () => {
    withItems([audio('a.m4a', { state: 'error', detail: 'sin red', progress: null })]);
    renderView();
    const row = await screen.findByTestId('inbox-item-a.m4a');
    expect(row).toHaveTextContent('Error de transcripción · sin red');
    fireEvent.click(screen.getByTestId('retry-a.m4a'));
    await waitFor(() =>
      expect(mockInvoke).toHaveBeenCalledWith('voice_retry', { vaultPath: '/v', relPath: 'Entrada/a.m4a' }),
    );
  });

  it('a transcribed note is a normal digestible item', async () => {
    withItems([note]);
    renderView();
    expect(await screen.findByTestId('digest-Nota de voz.md')).toBeInTheDocument();
  });
});
