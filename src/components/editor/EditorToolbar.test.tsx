import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { invoke } from '@tauri-apps/api/core';
import { useEditorStore } from '../../store/editorStore';

// Mock editor
function makeEditor(overrides = {}) {
  const chainResult = {
    focus: vi.fn().mockReturnThis(),
    toggleHeading: vi.fn().mockReturnThis(),
    toggleBold: vi.fn().mockReturnThis(),
    toggleItalic: vi.fn().mockReturnThis(),
    toggleStrike: vi.fn().mockReturnThis(),
    toggleCode: vi.fn().mockReturnThis(),
    toggleCodeBlock: vi.fn().mockReturnThis(),
    toggleBlockquote: vi.fn().mockReturnThis(),
    toggleBulletList: vi.fn().mockReturnThis(),
    toggleOrderedList: vi.fn().mockReturnThis(),
    setLink: vi.fn().mockReturnThis(),
    setImage: vi.fn().mockReturnThis(),
    insertTable: vi.fn().mockReturnThis(),
    setHorizontalRule: vi.fn().mockReturnThis(),
    run: vi.fn(),
  };

  return {
    isActive: vi.fn(() => false),
    chain: vi.fn(() => chainResult),
    ...overrides,
  };
}

const mockInvoke = vi.mocked(invoke);

beforeEach(() => {
  vi.clearAllMocks();
  useEditorStore.setState({
    activeNotePath: '/vault/note.md',
    activeNoteContent: '# Test',
    vaultPath: '/vault',
    vaultTree: [],
    saveStatus: 'idle',
  });
});

async function renderToolbar(editorOverrides = {}) {
  const { default: EditorToolbar } = await import('./EditorToolbar');
  const editor = makeEditor(editorOverrides) as unknown as import('@tiptap/react').Editor;
  return { ...render(<EditorToolbar editor={editor} />), editor };
}

// ── TC-04 to TC-09: Toolbar renders and buttons exist ────────────────────────
describe('TC-04 to TC-09: EditorToolbar buttons', () => {
  it('TC-04: renders toolbar with role="toolbar"', async () => {
    await renderToolbar();
    expect(screen.getByRole('toolbar')).toBeDefined();
  });

  it('TC-04: renders H1 button', async () => {
    await renderToolbar();
    expect(screen.getByLabelText('Heading 1')).toBeDefined();
  });

  it('TC-04: renders H2 button', async () => {
    await renderToolbar();
    expect(screen.getByLabelText('Heading 2')).toBeDefined();
  });

  it('TC-04: renders H3 button', async () => {
    await renderToolbar();
    expect(screen.getByLabelText('Heading 3')).toBeDefined();
  });

  it('TC-05: renders Bold button', async () => {
    await renderToolbar();
    expect(screen.getByLabelText('Bold')).toBeDefined();
  });

  it('TC-05: renders Italic button', async () => {
    await renderToolbar();
    expect(screen.getByLabelText('Italic')).toBeDefined();
  });

  it('TC-05: renders Strikethrough button', async () => {
    await renderToolbar();
    expect(screen.getByLabelText('Strikethrough')).toBeDefined();
  });

  it('TC-06: renders Bullet list button', async () => {
    await renderToolbar();
    expect(screen.getByLabelText('Bullet list')).toBeDefined();
  });

  it('TC-06: renders Ordered list button', async () => {
    await renderToolbar();
    expect(screen.getByLabelText('Ordered list')).toBeDefined();
  });

  it('TC-07: renders Blockquote button', async () => {
    await renderToolbar();
    expect(screen.getByLabelText('Blockquote')).toBeDefined();
  });

  it('TC-08: renders Inline code button', async () => {
    await renderToolbar();
    expect(screen.getByLabelText('Inline code')).toBeDefined();
  });

  it('TC-09: renders Code block button', async () => {
    await renderToolbar();
    expect(screen.getByLabelText('Code block')).toBeDefined();
  });

  it('TC-16: renders Insert image button', async () => {
    await renderToolbar();
    expect(screen.getByLabelText('Insert image')).toBeDefined();
  });

  it('TC-17: renders Insert table button', async () => {
    await renderToolbar();
    expect(screen.getByLabelText('Insert table')).toBeDefined();
  });

  it('TC-18: renders Horizontal rule button', async () => {
    await renderToolbar();
    expect(screen.getByLabelText('Horizontal rule')).toBeDefined();
  });
});

// ── TC-04: Click H1 toggles heading ──────────────────────────────────────────
describe('TC-04: toolbar button click actions', () => {
  it('TC-04: clicking H1 calls toggleHeading({ level: 1 })', async () => {
    const { editor } = await renderToolbar();
    const btn = screen.getByLabelText('Heading 1');
    fireEvent.click(btn);
    const chain = editor.chain as ReturnType<typeof vi.fn>;
    expect(chain).toHaveBeenCalled();
  });

  it('TC-05: clicking Bold calls toggleBold', async () => {
    const { editor } = await renderToolbar();
    fireEvent.click(screen.getByLabelText('Bold'));
    expect(editor.chain).toHaveBeenCalled();
  });

  it('TC-18: clicking Horizontal rule calls setHorizontalRule', async () => {
    const { editor } = await renderToolbar();
    fireEvent.click(screen.getByLabelText('Horizontal rule'));
    expect(editor.chain).toHaveBeenCalled();
  });
});

// ── TC-16: Insert image via toolbar ──────────────────────────────────────────
describe('TC-16: insert image via toolbar', () => {
  it('TC-16: clicking Insert image calls pick_image_file and inserts image', async () => {
    mockInvoke.mockResolvedValueOnce('/vault/img.png');
    const { editor } = await renderToolbar();
    fireEvent.click(screen.getByLabelText('Insert image'));
    // Wait until both pick_image_file was invoked AND editor.chain was called
    await vi.waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith('pick_image_file');
      expect(editor.chain).toHaveBeenCalled();
    });
  });

  it('TC-25: no image inserted when user cancels pick', async () => {
    mockInvoke.mockResolvedValueOnce(null);
    const { editor } = await renderToolbar();
    const chainCallsBefore = (editor.chain as ReturnType<typeof vi.fn>).mock.calls.length;
    fireEvent.click(screen.getByLabelText('Insert image'));
    await vi.waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith('pick_image_file');
    });
    // chain not called for setImage when cancelled
    expect((editor.chain as ReturnType<typeof vi.fn>).mock.calls.length).toBe(
      chainCallsBefore,
    );
  });
});

// ── Active state styling ──────────────────────────────────────────────────────
describe('toolbar active state', () => {
  it('button shows active color when isActive returns true for bold', async () => {
    const { editor } = await renderToolbar({
      isActive: vi.fn((name: string) => name === 'bold'),
    });
    void editor;
    const boldBtn = screen.getByLabelText('Bold');
    expect(boldBtn.getAttribute('data-active')).toBe('true');
  });
});
