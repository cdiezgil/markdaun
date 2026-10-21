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
  useInboxStore.setState({ items: [], selected: [], loading: false, error: null, areas: [], lastArea: null });
  useBrainStore.setState({ digest });
  useLlmStore.setState({ loaded: true, active: { connectionId: 'k', model: 'm' }, load: vi.fn() } as never);
  mockInvoke.mockImplementation(async (cmd: string) => {
    if (cmd === 'inbox_list') return ITEMS;
    if (cmd === 'inbox_list_areas') return ['Mutua', 'Personal'];
    if (cmd === 'inbox_get_last_area') return 'Personal';
    return undefined;
  });
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

  it('Digerir asks for the area, then digests that item inside it and goes to the Brain', async () => {
    renderView();
    fireEvent.click(await screen.findByTestId('digest-acta.md'));
    expect(digest).not.toHaveBeenCalled();
    fireEvent.click(await screen.findByTestId('area-Mutua'));
    await waitFor(() => expect(screen.getByTestId('brain-route')).toBeInTheDocument());
    expect(digest).toHaveBeenCalledWith([expect.objectContaining({ rel_path: 'Entrada/acta.md' })], '/v', 'Mutua');
    expect(mockInvoke).toHaveBeenCalledWith('inbox_set_last_area', { vaultPath: '/v', area: 'Mutua' });
  });

  it('the area menu lists the areas plus the vault root and highlights the last used one', async () => {
    renderView();
    fireEvent.click(await screen.findByTestId('digest-acta.md'));
    const menu = await screen.findByTestId('area-menu');
    expect(menu).toHaveTextContent('Mutua');
    expect(menu).toHaveTextContent('Bóveda (raíz)');
    expect(screen.getByTestId('area-Personal')).toHaveAttribute('aria-current', 'true');
    expect(screen.getByTestId('area-Mutua')).not.toHaveAttribute('aria-current');
  });

  it('the vault root is chosen as the empty area', async () => {
    renderView();
    fireEvent.click(await screen.findByTestId('digest-acta.md'));
    fireEvent.click(await screen.findByTestId('area-root'));
    await waitFor(() => expect(digest).toHaveBeenCalled());
    expect(digest.mock.calls[0][2]).toBe('');
  });

  it('Escape closes the area menu without digesting', async () => {
    renderView();
    fireEvent.click(await screen.findByTestId('digest-acta.md'));
    fireEvent.keyDown(await screen.findByTestId('area-menu'), { key: 'Escape' });
    expect(screen.queryByTestId('area-menu')).toBeNull();
    expect(digest).not.toHaveBeenCalled();
  });

  it('Digerir seleccionados digests the selection in order', async () => {
    renderView();
    fireEvent.click(await screen.findByTestId('select-acta.md'));
    fireEvent.click(screen.getByTestId('select-foto.png'));
    fireEvent.click(screen.getByTestId('digest-selected'));
    fireEvent.click(await screen.findByTestId('area-Mutua'));
    await waitFor(() => expect(digest).toHaveBeenCalled());
    expect(digest.mock.calls[0][0].map((i: InboxItem) => i.name)).toEqual(['acta.md', 'foto.png']);
    expect(digest.mock.calls[0][2]).toBe('Mutua');
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

  describe('Añadir URL', () => {
    const clipped = {
      path: '/v/Entrada/Art.md',
      rel_path: 'Entrada/Art.md',
      title: 'Art',
      clipped: true,
      failure: null,
      words: 321,
      images_downloaded: 2,
      images_failed: 0,
    };

    it('opens an input, clips the url and reports the result', async () => {
      mockInvoke.mockImplementation(async (cmd: string) => {
        if (cmd === 'inbox_clip_url') return clipped;
        return cmd === 'inbox_list' ? ITEMS : undefined;
      });
      renderView();
      fireEvent.click(await screen.findByTestId('add-url'));
      const input = screen.getByTestId('clip-url-input');
      fireEvent.change(input, { target: { value: 'https://example.com/a' } });
      fireEvent.click(screen.getByTestId('clip-url-submit'));
      await waitFor(() =>
        expect(mockInvoke).toHaveBeenCalledWith('inbox_clip_url', { url: 'https://example.com/a', vaultPath: '/v' }),
      );
      expect(await screen.findByTestId('clip-result')).toHaveTextContent('Art');
      expect(screen.getByTestId('clip-result')).toHaveTextContent('321 palabras');
      expect(screen.getByTestId('clip-result')).toHaveTextContent('2 imágenes');
    });

    it('says when only the link could be saved', async () => {
      mockInvoke.mockImplementation(async (cmd: string) => {
        if (cmd === 'inbox_clip_url') return { ...clipped, clipped: false, failure: 'HTTP 404' };
        return cmd === 'inbox_list' ? ITEMS : undefined;
      });
      renderView();
      fireEvent.click(await screen.findByTestId('add-url'));
      fireEvent.change(screen.getByTestId('clip-url-input'), { target: { value: 'https://example.com/x' } });
      fireEvent.keyDown(screen.getByTestId('clip-url-input'), { key: 'Enter' });
      const msg = await screen.findByTestId('clip-result');
      expect(msg).toHaveTextContent('No se pudo recortar: HTTP 404');
      expect(msg).toHaveTextContent('enlace');
    });

    it('does not submit an empty url', async () => {
      renderView();
      fireEvent.click(await screen.findByTestId('add-url'));
      expect(screen.getByTestId('clip-url-submit')).toBeDisabled();
    });

    it('shows a friendly message for an invalid url', async () => {
      mockInvoke.mockImplementation(async (cmd: string) => {
        if (cmd === 'inbox_clip_url') throw 'invalid_url';
        return cmd === 'inbox_list' ? ITEMS : undefined;
      });
      renderView();
      fireEvent.click(await screen.findByTestId('add-url'));
      fireEvent.change(screen.getByTestId('clip-url-input'), { target: { value: 'hola' } });
      fireEvent.click(screen.getByTestId('clip-url-submit'));
      expect(await screen.findByRole('alert')).toHaveTextContent('dirección');
    });
  });
});

  describe('TC-24..TC-26: docx/pptx office import UI', () => {
    const docxItem = item('informe.docx', 'docx');
    const pdfItem = item('paper.pdf', 'pdf');
    const MIXED = [docxItem, pdfItem, item('hoja.xlsx', 'other')];

    beforeEach(() => {
      mockInvoke.mockImplementation(async (cmd: string) => {
        if (cmd === 'inbox_list') return MIXED;
        if (cmd === 'inbox_list_areas') return [];
        if (cmd === 'inbox_get_last_area') return null;
        if (cmd === 'inbox_all_folders') return ['Entrada', 'Proyectos'];
        return undefined;
      });
    });

    it('TC-24: docx item shows Importar button, not Digerir', async () => {
      renderView();
      expect(await screen.findByTestId('import-informe.docx')).toBeInTheDocument();
      expect(screen.queryByTestId('digest-informe.docx')).toBeNull();
    });

    it('TC-25: pdf item shows Importar button, not Digerir (PDF now uses import flow)', async () => {
      renderView();
      expect(await screen.findByTestId('import-paper.pdf')).toBeInTheDocument();
      expect(screen.queryByTestId('digest-paper.pdf')).toBeNull();
    });

    it('TC-26: docx item checkbox is disabled', async () => {
      renderView();
      expect(await screen.findByTestId('select-informe.docx')).toBeDisabled();
    });
  });

  // ─── TC-19..TC-21: destination picker integration ────────────────────────

  describe('TC-19..TC-21: DestinationPicker integration in InboxView', () => {
    const docxItem = item('informe.docx', 'docx');
    const MIXED = [docxItem, item('paper.pdf', 'pdf')];

    beforeEach(() => {
      mockInvoke.mockImplementation(async (cmd: string) => {
        if (cmd === 'inbox_list') return MIXED;
        if (cmd === 'inbox_list_areas') return [];
        if (cmd === 'inbox_get_last_area') return null;
        if (cmd === 'inbox_all_folders') return ['Entrada', 'Proyectos', 'Personal'];
        return undefined;
      });
    });

    it('TC-19: clicking Importar opens the DestinationPicker', async () => {
      renderView();
      const btn = await screen.findByTestId('import-informe.docx');
      fireEvent.click(btn);
      expect(await screen.findByTestId('destination-picker')).toBeInTheDocument();
    });

    it('TC-20: confirming a destination calls importOffice with destPath and shows the result message', async () => {
      mockInvoke.mockImplementation(async (cmd: string) => {
        if (cmd === 'inbox_list') return MIXED;
        if (cmd === 'inbox_list_areas') return [];
        if (cmd === 'inbox_get_last_area') return null;
        if (cmd === 'inbox_all_folders') return ['Entrada', 'Proyectos', 'Personal'];
        if (cmd === 'office_import') return [
          '/v/Proyectos/informe/01 - Intro.md',
          '/v/Proyectos/informe/02 - Datos.md',
          '/v/Proyectos/informe/índice.md',
        ];
        if (cmd === 'list_vault_tree') return [];
        return undefined;
      });
      renderView();
      fireEvent.click(await screen.findByTestId('import-informe.docx'));
      fireEvent.click(await screen.findByTestId('dest-Proyectos'));
      fireEvent.click(screen.getByTestId('confirm-import'));
      expect(await screen.findByTestId('import-result')).toHaveTextContent('Proyectos');
      expect(mockInvoke).toHaveBeenCalledWith('office_import', expect.objectContaining({
        destPath: 'Proyectos',
      }));
    });

    it('TC-21: cancelling the picker does NOT call importOffice and closes the picker', async () => {
      renderView();
      fireEvent.click(await screen.findByTestId('import-informe.docx'));
      expect(await screen.findByTestId('destination-picker')).toBeInTheDocument();
      fireEvent.click(screen.getByTestId('cancel-import'));
      expect(screen.queryByTestId('destination-picker')).toBeNull();
      expect(mockInvoke).not.toHaveBeenCalledWith('office_import', expect.anything());
    });
  });

  // ─── TC-67: PDF import UI ───────────────────────────────────────────────

  describe('TC-67i, TC-67j: PDF import via DestinationPicker', () => {
    const pdfItem = item('doc.pdf', 'pdf');
    const PDF_INBOX = [pdfItem];

    beforeEach(() => {
      // LLM is active by default (set in outer beforeEach)
      mockInvoke.mockImplementation(async (cmd: string) => {
        if (cmd === 'inbox_list') return PDF_INBOX;
        if (cmd === 'inbox_list_areas') return [];
        if (cmd === 'inbox_get_last_area') return null;
        if (cmd === 'inbox_all_folders') return ['Entrada', 'Ideas'];
        if (cmd === 'pdf_import') return ['/v/Ideas/doc/01 - Sección.md', '/v/Ideas/doc/índice.md'];
        if (cmd === 'list_vault_tree') return [];
        return undefined;
      });
    });

    it('TC-67i: clicking Importar on a PDF opens DestinationPicker; confirming calls pdf_import', async () => {
      renderView();
      const btn = await screen.findByTestId('import-doc.pdf');
      expect(btn).not.toBeDisabled();
      fireEvent.click(btn);

      // DestinationPicker is shown
      expect(await screen.findByTestId('destination-picker')).toBeInTheDocument();

      // Confirm with 'Ideas' folder
      fireEvent.click(await screen.findByTestId('dest-Ideas'));
      fireEvent.click(screen.getByTestId('confirm-import'));

      await waitFor(() =>
        expect(mockInvoke).toHaveBeenCalledWith('pdf_import', expect.objectContaining({
          sourcePath: '/v/Entrada/doc.pdf',
          vaultPath: '/v',
          destPath: 'Ideas',
        })),
      );
    });

    it('TC-67j: Importar button is disabled for PDFs when no LLM connection is active', async () => {
      useLlmStore.setState({ loaded: true, active: null, load: vi.fn() } as never);
      renderView();
      const btn = await screen.findByTestId('import-doc.pdf');
      expect(btn).toBeDisabled();
    });
  });
