import { describe, it, expect, vi, beforeEach } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import { useEditorStore } from '../store/editorStore';
import { useVaultStore } from '../store/vaultStore';
import { followH1Title, readH1, firstH1ContentEnd } from './h1Follow';

const mockInvoke = vi.mocked(invoke);

beforeEach(() => {
  vi.clearAllMocks();
  useEditorStore.setState({
    activeNotePath: '/vault/Sin título.md',
    activeNoteContent: '# Idea',
    vaultPath: '/vault',
    isDirty: false,
    relocation: null,
  });
  useVaultStore.setState({ vaultPath: '/vault', tree: [], selectedFolder: null });
});

describe('followH1Title', () => {
  it('renames the active note and moves the open path', async () => {
    mockInvoke.mockImplementation(async (cmd: string) =>
      cmd === 'rename_note_from_title'
        ? { following: true, path: '/vault/Idea.md', rewritten: [] }
        : [],
    );
    const following = await followH1Title('Idea');
    expect(following).toBe(true);
    expect(mockInvoke).toHaveBeenCalledWith('rename_note_from_title', {
      path: '/vault/Sin título.md',
      title: 'Idea',
      vaultPath: '/vault',
    });
    expect(useEditorStore.getState().activeNotePath).toBe('/vault/Idea.md');
    expect(mockInvoke).toHaveBeenCalledWith('list_vault_tree', { vaultPath: '/vault' });
  });

  it('does nothing to the open path when the name did not change', async () => {
    mockInvoke.mockResolvedValue({ following: true, path: '/vault/Sin título.md', rewritten: [] });
    await followH1Title('Sin título');
    expect(useEditorStore.getState().activeNotePath).toBe('/vault/Sin título.md');
    expect(mockInvoke).not.toHaveBeenCalledWith('list_vault_tree', expect.anything());
  });

  it('reports notes that no longer follow', async () => {
    mockInvoke.mockResolvedValue({ following: false, path: '/vault/Sin título.md', rewritten: [] });
    expect(await followH1Title('Idea')).toBe(false);
  });

  it('is a no-op without an active note', async () => {
    useEditorStore.setState({ activeNotePath: null });
    expect(await followH1Title('Idea')).toBe(false);
    expect(mockInvoke).not.toHaveBeenCalled();
  });
});

function fakeDoc(blocks: { type: string; level?: number; text: string }[], selectionIn: number) {
  const nodes = blocks.map((b) => ({
    type: { name: b.type },
    attrs: { level: b.level },
    content: { size: b.text.length },
    textBetween: () => b.text,
  }));
  return {
    state: {
      doc: {
        descendants: (cb: (n: unknown) => boolean | void) => {
          for (const n of nodes) if (cb(n) === false) break;
        },
      },
      selection: { $from: { parent: nodes[selectionIn] } },
    },
  };
}

describe('readH1', () => {
  it('reads the first H1 text and whether the cursor is inside an H1', () => {
    const editor = fakeDoc(
      [
        { type: 'heading', level: 2, text: 'Sub' },
        { type: 'heading', level: 1, text: 'Título' },
        { type: 'paragraph', text: 'cuerpo' },
      ],
      1,
    );
    expect(readH1(editor as never)).toEqual({ inH1: true, title: 'Título' });
  });

  it('cursor in a paragraph or H2 is not in the H1', () => {
    const editor = fakeDoc(
      [
        { type: 'heading', level: 1, text: 'T' },
        { type: 'heading', level: 2, text: 'S' },
      ],
      1,
    );
    expect(readH1(editor as never).inH1).toBe(false);
  });

  it('empty when there is no H1', () => {
    const editor = fakeDoc([{ type: 'paragraph', text: 'x' }], 0);
    expect(readH1(editor as never)).toEqual({ inH1: false, title: '' });
  });
});

describe('firstH1ContentEnd', () => {
  it('returns the position where the first H1 content ends', () => {
    const doc = {
      descendants: (cb: (n: unknown, pos: number) => boolean | void) => {
        cb({ type: { name: 'paragraph' }, attrs: {}, nodeSize: 5 }, 0);
        cb({ type: { name: 'heading' }, attrs: { level: 1 }, nodeSize: 7, content: { size: 5 } }, 5);
      },
    };
    expect(firstH1ContentEnd({ state: { doc } } as never)).toBe(11);
  });

  it('is null without an H1', () => {
    const doc = { descendants: () => undefined };
    expect(firstH1ContentEnd({ state: { doc } } as never)).toBeNull();
  });
});
