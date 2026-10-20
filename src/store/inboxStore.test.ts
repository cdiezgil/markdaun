import { describe, it, expect, vi, beforeEach } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import { useInboxStore } from './inboxStore';
import { useVaultStore } from './vaultStore';
import type { InboxItem } from '../lib/tauri';

const mockInvoke = vi.mocked(invoke);

const item = (name: string, over: Partial<InboxItem> = {}): InboxItem => ({
  name,
  path: `/v/Entrada/${name}`,
  rel_path: `Entrada/${name}`,
  kind: 'md',
  size: 10,
  added_ms: 1,
  supported: true,
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  useInboxStore.setState({ items: [], selected: [], loading: false, error: null });
  // Ensure vaultStore has a vaultPath so importOffice can trigger refreshTree.
  useVaultStore.setState({ vaultPath: '/v' } as never);
});

describe('inboxStore', () => {
  it('load fills the items and the counter', async () => {
    mockInvoke.mockResolvedValueOnce([item('a.md'), item('b.pdf', { kind: 'pdf' })] as never);
    await useInboxStore.getState().load('/v');
    expect(mockInvoke).toHaveBeenCalledWith('inbox_list', { vaultPath: '/v' });
    expect(useInboxStore.getState().items).toHaveLength(2);
  });

  it('load keeps the error and does not throw', async () => {
    mockInvoke.mockRejectedValueOnce('io_error: boom' as never);
    await useInboxStore.getState().load('/v');
    expect(useInboxStore.getState().error).toBe('io_error: boom');
  });

  it('toggle selects and unselects supported items only', () => {
    useInboxStore.setState({ items: [item('a.md'), item('x.docx', { kind: 'other', supported: false })] });
    useInboxStore.getState().toggle('Entrada/a.md');
    useInboxStore.getState().toggle('Entrada/x.docx');
    expect(useInboxStore.getState().selected).toEqual(['Entrada/a.md']);
    useInboxStore.getState().toggle('Entrada/a.md');
    expect(useInboxStore.getState().selected).toEqual([]);
  });

  it('selectAll selects every supported item', () => {
    useInboxStore.setState({ items: [item('a.md'), item('x.docx', { kind: 'other', supported: false }), item('b.txt')] });
    useInboxStore.getState().selectAll();
    expect(useInboxStore.getState().selected).toEqual(['Entrada/a.md', 'Entrada/b.txt']);
  });

  it('discard moves the item out of the list and the selection', async () => {
    useInboxStore.setState({ items: [item('a.md'), item('b.md')], selected: ['Entrada/a.md'] });
    mockInvoke.mockResolvedValueOnce(undefined as never);
    await useInboxStore.getState().discard(item('a.md'), '/v');
    expect(mockInvoke).toHaveBeenCalledWith('inbox_discard', { path: '/v/Entrada/a.md', vaultPath: '/v' });
    expect(useInboxStore.getState().items.map((i) => i.name)).toEqual(['b.md']);
    expect(useInboxStore.getState().selected).toEqual([]);
  });

  describe('clipUrl', () => {
    const summary = {
      path: '/v/Entrada/A.md',
      rel_path: 'Entrada/A.md',
      title: 'A',
      clipped: true,
      failure: null,
      words: 10,
      images_downloaded: 0,
      images_failed: 0,
    };

    it('clips, reloads the list and reports the outcome', async () => {
      mockInvoke.mockImplementation(async (cmd: string) => (cmd === 'inbox_clip_url' ? summary : [item('A.md')]));
      const out = await useInboxStore.getState().clipUrl('https://x.test/a', '/v');
      expect(mockInvoke).toHaveBeenCalledWith('inbox_clip_url', { url: 'https://x.test/a', vaultPath: '/v' });
      expect(out).toEqual(summary);
      expect(useInboxStore.getState().items).toHaveLength(1);
      expect(useInboxStore.getState().clipping).toBe(false);
      expect(useInboxStore.getState().error).toBeNull();
    });

    it('keeps the error for an invalid url and does not throw', async () => {
      mockInvoke.mockRejectedValueOnce('invalid_url' as never);
      const out = await useInboxStore.getState().clipUrl('nope', '/v');
      expect(out).toBeNull();
      expect(useInboxStore.getState().error).toBe('invalid_url');
      expect(useInboxStore.getState().clipping).toBe(false);
    });

    it('is marked busy while clipping', async () => {
      let release: (v: unknown) => void = () => {};
      mockInvoke.mockImplementationOnce(() => new Promise((r) => (release = r)) as never);
      mockInvoke.mockResolvedValue([] as never);
      const p = useInboxStore.getState().clipUrl('https://x.test/a', '/v');
      expect(useInboxStore.getState().clipping).toBe(true);
      release(summary);
      await p;
      expect(useInboxStore.getState().clipping).toBe(false);
    });
  });
});

  // ─── TC-12..TC-14: loadAllFolders + importOffice with destPath ─────────────

  describe('TC-12..TC-14: allFolders and importOffice with destPath', () => {
    const docxItem = item('reporte.docx', { kind: 'docx' });

    it('TC-12: loadAllFolders updates allFolders from inbox_all_folders', async () => {
      useInboxStore.setState({ allFolders: [] } as never);
      mockInvoke.mockResolvedValueOnce(['Entrada', 'Proyectos'] as never);
      await useInboxStore.getState().loadAllFolders('/v');
      expect(mockInvoke).toHaveBeenCalledWith('inbox_all_folders', { vaultPath: '/v' });
      expect(useInboxStore.getState().allFolders).toEqual(['Entrada', 'Proyectos']);
    });

    it('TC-13: importOffice passes destPath to office_import and returns destPath in result', async () => {
      useInboxStore.setState({ items: [docxItem], importing: false, error: null } as never);
      mockInvoke.mockImplementation(async (cmd: string) => {
        if (cmd === 'office_import') return ['/v/Proyectos/reporte/01 - A.md', '/v/Proyectos/reporte/índice.md'];
        if (cmd === 'inbox_list') return [docxItem];
        if (cmd === 'list_vault_tree') return [];
        return undefined;
      });
      const result = await useInboxStore.getState().importOffice(docxItem, '/v', 'Proyectos');
      expect(mockInvoke).toHaveBeenCalledWith('office_import', {
        sourcePath: docxItem.path,
        vaultPath: '/v',
        destPath: 'Proyectos',
      });
      expect(mockInvoke).toHaveBeenCalledWith('list_vault_tree', { vaultPath: '/v' });
      expect(useInboxStore.getState().importing).toBe(false);
      expect(useInboxStore.getState().error).toBeNull();
      expect(result).toEqual({ stem: 'reporte', count: 1, destPath: 'Proyectos' });
    });

    it('TC-14: importOffice sets error on failure and clears importing flag', async () => {
      useInboxStore.setState({ items: [docxItem], importing: false, error: null } as never);
      mockInvoke.mockRejectedValueOnce('invalid_document: boom' as never);
      const result = await useInboxStore.getState().importOffice(docxItem, '/v', 'Proyectos');
      expect(result).toBeNull();
      expect(useInboxStore.getState().importing).toBe(false);
      expect(useInboxStore.getState().error).toBe('invalid_document: boom');
    });
  });

  // ─── TC-21..TC-23 (updated to new importOffice signature) ────────────────

  describe('TC-21..TC-23: importOffice', () => {
    const docxItem = item('reporte.docx', { kind: 'docx' });

    it('TC-21: importOffice calls office_import, reloads the inbox, refreshes the vault tree, and returns stem+count+destPath', async () => {
      useInboxStore.setState({ items: [docxItem], importing: false, error: null } as never);
      mockInvoke.mockImplementation(async (cmd: string) => {
        if (cmd === 'office_import') return ['/v/Proyectos/reporte/01 - A.md', '/v/Proyectos/reporte/índice.md'];
        if (cmd === 'inbox_list') return [docxItem];
        if (cmd === 'list_vault_tree') return [];
        return undefined;
      });
      const result = await useInboxStore.getState().importOffice(docxItem, '/v', 'Proyectos');
      expect(mockInvoke).toHaveBeenCalledWith('office_import', {
        sourcePath: docxItem.path,
        vaultPath: '/v',
        destPath: 'Proyectos',
      });
      // vault tree must be refreshed so <dest>/<stem>/ becomes visible
      expect(mockInvoke).toHaveBeenCalledWith('list_vault_tree', { vaultPath: '/v' });
      expect(useInboxStore.getState().importing).toBe(false);
      expect(useInboxStore.getState().error).toBeNull();
      // returns stem derived from filename and note count excluding index
      expect(result).toEqual({ stem: 'reporte', count: 1, destPath: 'Proyectos' });
    });

    it('TC-22: importOffice sets error on failure and clears importing flag', async () => {
      useInboxStore.setState({ items: [docxItem], importing: false, error: null } as never);
      mockInvoke.mockRejectedValueOnce('invalid_document: boom' as never);
      await useInboxStore.getState().importOffice(docxItem, '/v', 'Proyectos');
      expect(useInboxStore.getState().importing).toBe(false);
      expect(useInboxStore.getState().error).toBe('invalid_document: boom');
    });

    it('TC-23: toggle does not select a docx item (not batchable)', () => {
      useInboxStore.setState({ items: [docxItem], selected: [] });
      useInboxStore.getState().toggle(docxItem.rel_path);
      expect(useInboxStore.getState().selected).toEqual([]);
    });
  });
