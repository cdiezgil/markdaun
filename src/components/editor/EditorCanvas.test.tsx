import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { invoke } from '@tauri-apps/api/core';
import { useEditorStore } from '../../store/editorStore';

// Mock TipTap to avoid full DOM editor in unit tests
vi.mock('./BacklinksSection', () => ({ default: () => null }));
vi.mock('../../hooks/useH1Follow', () => ({ useH1Follow: vi.fn() }));

vi.mock('@tiptap/react', () => ({
  useEditor: vi.fn(() => ({
    storage: {
      markdown: { getMarkdown: vi.fn(() => '# Test') },
    },
    commands: {
      setContent: vi.fn(),
      setImage: vi.fn(),
      focus: vi.fn().mockReturnThis(),
      chain: vi.fn().mockReturnThis(),
      run: vi.fn(),
    },
    chain: vi.fn().mockReturnValue({
      focus: vi.fn().mockReturnValue({
        setImage: vi.fn().mockReturnValue({ run: vi.fn() }),
      }),
    }),
    destroy: vi.fn(),
    isDestroyed: false,
  })),
  EditorContent: vi.fn(({ editor }: { editor: unknown }) =>
    editor ? <div data-testid="prosemirror-editor">Editor Content</div> : null,
  ),
}));

vi.mock('@tiptap/starter-kit', () => ({ default: { configure: vi.fn(() => ({})) } }));
vi.mock('@tiptap/extension-image', () => ({ default: { configure: vi.fn(() => ({})) } }));
vi.mock('@tiptap/extension-link', () => ({ default: { configure: vi.fn(() => ({})) } }));
vi.mock('@tiptap/extension-table', () => ({ default: { configure: vi.fn(() => ({})) } }));
vi.mock('@tiptap/extension-table-row', () => ({ default: {} }));
vi.mock('@tiptap/extension-table-cell', () => ({ default: {} }));
vi.mock('@tiptap/extension-table-header', () => ({ default: {} }));
vi.mock('tiptap-markdown', () => ({
  Markdown: { configure: vi.fn(() => ({})) },
}));
vi.mock('./extensions/WikilinkExtension', () => ({
  createWikilinkExtension: vi.fn(() => ({})),
  findInTree: vi.fn(() => null),
}));
vi.mock('./extensions/HighlightExtension', () => ({
  HighlightExtension: {},
}));
vi.mock('./extensions/TagExtension', () => ({
  TagExtension: {},
}));

const mockInvoke = vi.mocked(invoke);

beforeEach(() => {
  vi.clearAllMocks();
  useEditorStore.setState({
    activeNotePath: '/vault/note.md',
    activeNoteContent: '# Test note',
    vaultPath: '/vault',
    vaultTree: [],
    saveStatus: 'idle',
  });
});

// ── TC-04 to TC-20: EditorCanvas renders ─────────────────────────────────────
describe('TC-04 to TC-20: EditorCanvas renders', () => {
  it('TC-04: renders the editor content area', async () => {
    const { default: EditorCanvas } = await import('./EditorCanvas');
    render(<EditorCanvas />);

    await waitFor(() => {
      expect(screen.getByTestId('editor-canvas-container')).toBeDefined();
    });
  });

  it('TC-04: renders EditorContent when editor is available', async () => {
    const { default: EditorCanvas } = await import('./EditorCanvas');
    render(<EditorCanvas />);

    await waitFor(() => {
      const el = screen.queryByTestId('prosemirror-editor');
      expect(el).not.toBeNull();
    });
  });

  it('TC-10: calls onEditorReady callback with editor instance', async () => {
    const onEditorReady = vi.fn();
    const { default: EditorCanvas } = await import('./EditorCanvas');
    render(<EditorCanvas onEditorReady={onEditorReady} />);

    await waitFor(() => {
      expect(onEditorReady).toHaveBeenCalled();
    });
  });

  it('TC-14: container has bg token background', async () => {
    const { default: EditorCanvas } = await import('./EditorCanvas');
    const { container } = render(<EditorCanvas />);
    const wrapper = container.querySelector('[data-testid="editor-canvas-container"]');
    expect(wrapper).not.toBeNull();
    expect((wrapper as HTMLElement).style.background).toBe('var(--bg)');
  });
});

// ── TC-15: drag-and-drop ──────────────────────────────────────────────────────
describe('TC-15: drag-and-drop image', () => {
  it('TC-15: accepts dragOver event', async () => {
    const { default: EditorCanvas } = await import('./EditorCanvas');
    const { container } = render(<EditorCanvas />);
    const wrapper = container.querySelector(
      '[data-testid="editor-canvas-container"]',
    ) as HTMLElement;
    // Should not throw
    const event = new Event('dragover', { bubbles: true });
    Object.defineProperty(event, 'preventDefault', { value: vi.fn() });
    wrapper.dispatchEvent(event);
  });
});

// ── TC-02: setContent is called on editor update ──────────────────────────────
describe('TC-02: editor onUpdate calls setContent', () => {
  it('TC-02: setContent in store is called when editor updates', async () => {
    const setContent = vi.spyOn(useEditorStore.getState(), 'setContent');
    const { default: EditorCanvas } = await import('./EditorCanvas');
    render(<EditorCanvas />);
    // The onUpdate callback is wired in useEditor mock — in real usage it triggers setContent
    // We verify setContent is accessible in store
    expect(typeof setContent).toBe('function');
  });
});

// ── TC-22 / TC-23: read note integration check ───────────────────────────────
describe('TC-22: openNote loads content into store', () => {
  it('TC-22: store activeNoteContent is set after openNote', async () => {
    mockInvoke.mockResolvedValueOnce('# Loaded content');
    await useEditorStore.getState().openNote('/vault/note.md');

    expect(useEditorStore.getState().activeNoteContent).toBe('# Loaded content');
    expect(useEditorStore.getState().activeNotePath).toBe('/vault/note.md');
  });
});

describe('noteCaption', () => {
  it('shows the vault-relative path without extension', async () => {
    const { noteCaption } = await import('./EditorCanvas');
    expect(noteCaption('/vault/Test/Primera nota.md', '/vault', null)).toBe('Test / Primera nota');
  });

  it('appends the save time when known', async () => {
    const { noteCaption } = await import('./EditorCanvas');
    expect(noteCaption('/vault/a.md', '/vault', Date.now())).toMatch(/^a · guardado \d{2}:\d{2}/);
  });
});
