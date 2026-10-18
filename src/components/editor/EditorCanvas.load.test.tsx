import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from '@testing-library/react';
import { act } from 'react';
import { useEditorStore } from '../../store/editorStore';

vi.mock('./BacklinksSection', () => ({ default: () => null }));
vi.mock('../../hooks/useH1Follow', () => ({ useH1Follow: vi.fn() }));

const setContentCmd = vi.fn();
const focusCmd = vi.fn();
const editor = {
  storage: { markdown: { getMarkdown: () => '# Test' } },
  commands: { setContent: setContentCmd, focus: focusCmd },
  state: { doc: { descendants: vi.fn() } },
  destroy: vi.fn(),
  isDestroyed: false,
};

vi.mock('@tiptap/react', () => ({
  useEditor: vi.fn(() => editor),
  EditorContent: () => <div data-testid="prosemirror-editor" />,
}));
vi.mock('@tiptap/starter-kit', () => ({ default: { configure: vi.fn(() => ({})) } }));
vi.mock('@tiptap/extension-image', () => ({ default: { configure: vi.fn(() => ({})) } }));
vi.mock('@tiptap/extension-link', () => ({ default: { configure: vi.fn(() => ({})) } }));
vi.mock('@tiptap/extension-table', () => ({ default: { configure: vi.fn(() => ({})) } }));
vi.mock('@tiptap/extension-table-row', () => ({ default: {} }));
vi.mock('@tiptap/extension-table-cell', () => ({ default: {} }));
vi.mock('@tiptap/extension-table-header', () => ({ default: {} }));
vi.mock('tiptap-markdown', () => ({ Markdown: { configure: vi.fn(() => ({})) } }));
vi.mock('./extensions/WikilinkExtension', () => ({ createWikilinkExtension: vi.fn(() => ({})) }));
vi.mock('./extensions/HighlightExtension', () => ({ HighlightExtension: {} }));
vi.mock('./extensions/TagExtension', () => ({ TagExtension: {} }));
vi.mock('../../lib/h1Follow', () => ({ firstH1ContentEnd: vi.fn(() => 9) }));

import EditorCanvas from './EditorCanvas';

beforeEach(() => {
  vi.clearAllMocks();
  useEditorStore.setState({
    activeNotePath: '/vault/Sin título.md',
    activeNoteContent: '# ',
    vaultPath: '/vault',
    vaultTree: [],
    loadVersion: 1,
    focusTitleOnOpen: false,
    relocation: null,
  });
});

describe('EditorCanvas content loading', () => {
  it('loads the content on mount', () => {
    render(<EditorCanvas />);
    expect(setContentCmd).toHaveBeenCalledWith('# ');
  });

  it('keeps the editor content when the path changes by a rename (no reload, cursor kept)', () => {
    render(<EditorCanvas />);
    setContentCmd.mockClear();
    act(() => useEditorStore.setState({ activeNotePath: '/vault/Idea.md' }));
    expect(setContentCmd).not.toHaveBeenCalled();
  });

  it('reloads when a note is (re)loaded', () => {
    render(<EditorCanvas />);
    setContentCmd.mockClear();
    act(() =>
      useEditorStore.setState({ activeNotePath: '/vault/otra.md', activeNoteContent: '# Otra', loadVersion: 2 }),
    );
    expect(setContentCmd).toHaveBeenCalledWith('# Otra');
  });

  it('puts the cursor at the end of the empty H1 of a new note and clears the request', () => {
    useEditorStore.setState({ focusTitleOnOpen: true });
    render(<EditorCanvas />);
    expect(focusCmd).toHaveBeenCalledWith(9);
    expect(useEditorStore.getState().focusTitleOnOpen).toBe(false);
  });

  it('does not steal focus for ordinary opens', () => {
    render(<EditorCanvas />);
    expect(focusCmd).not.toHaveBeenCalled();
  });
});
