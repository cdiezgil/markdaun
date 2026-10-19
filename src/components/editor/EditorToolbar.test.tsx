import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act, within } from '@testing-library/react';
import { invoke } from '@tauri-apps/api/core';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { useEditorStore } from '../../store/editorStore';
import { useBrainStore } from '../../store/brainStore';

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
    insertMermaid: vi.fn().mockReturnThis(),
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
  return {
    ...render(
      <MemoryRouter initialEntries={['/editor/x']}>
        <Routes>
          <Route path="/editor/x" element={<EditorToolbar editor={editor} />} />
          <Route path="/brain" element={<div data-testid="brain-route" />} />
        </Routes>
      </MemoryRouter>,
    ),
    editor,
  };
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

describe('Mermaid diagram button', () => {
  it('inserts a mermaid block through the editor command', async () => {
    const { editor } = await renderToolbar();
    fireEvent.click(screen.getByLabelText('Diagrama'));
    const chain = (editor.chain as unknown as ReturnType<typeof vi.fn>).mock.results[0].value;
    expect(chain.insertMermaid).toHaveBeenCalled();
    expect(chain.run).toHaveBeenCalled();
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

// ── Selector de tamaño de tabla ──────────────────────────────────────────────
describe('selector de tamaño de tabla', () => {
  it('el botón de tabla abre el picker en lugar de insertar directamente', async () => {
    const { editor } = await renderToolbar();
    fireEvent.click(screen.getByLabelText('Insert table'));

    expect(await screen.findByTestId('table-size-picker')).toBeInTheDocument();
    expect(editor.chain).not.toHaveBeenCalled();
  });

  it('elegir 4 × 2 en la rejilla inserta la tabla con esas filas y columnas', async () => {
    const { editor } = await renderToolbar();
    fireEvent.click(screen.getByLabelText('Insert table'));

    fireEvent.click(await screen.findByTestId('table-size-cell-3-1'));

    const chain = editor.chain as ReturnType<typeof vi.fn>;
    expect(chain).toHaveBeenCalled();
    const chainResult = chain.mock.results[0].value as Record<string, ReturnType<typeof vi.fn>>;
    expect(chainResult.insertTable).toHaveBeenCalledWith({
      rows: 4,
      cols: 2,
      withHeaderRow: true,
    });
    expect(chainResult.run).toHaveBeenCalled();
    // El picker se cierra tras insertar
    expect(screen.queryByTestId('table-size-picker')).toBeNull();
  });

  it('Escape cierra el picker sin insertar nada', async () => {
    const { editor } = await renderToolbar();
    fireEvent.click(screen.getByLabelText('Insert table'));
    await screen.findByTestId('table-size-picker');

    fireEvent.keyDown(window, { key: 'Escape' });

    expect(screen.queryByTestId('table-size-picker')).toBeNull();
    expect(editor.chain).not.toHaveBeenCalled();
  });

  it('click fuera (overlay) cierra el picker sin insertar', async () => {
    const { editor } = await renderToolbar();
    fireEvent.click(screen.getByLabelText('Insert table'));
    await screen.findByTestId('table-size-picker');

    fireEvent.click(screen.getByTestId('table-size-picker-overlay'));

    expect(screen.queryByTestId('table-size-picker')).toBeNull();
    expect(editor.chain).not.toHaveBeenCalled();
  });

  it('el picker no se abre sin editor', async () => {
    const { default: EditorToolbar } = await import('./EditorToolbar');
    render(
      <MemoryRouter>
        <EditorToolbar editor={null} />
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByLabelText('Insert table'));
    expect(screen.queryByTestId('table-size-picker')).toBeNull();
  });
});


// ── TC-07 / TC-08: Plain-MD mode toggle button ──────────────────────────────
describe('TC-07 / TC-08: plain-MD toggle button', () => {
  it('TC-07: renders the toggle button with correct label when plainMdMode=false', async () => {
    const { default: EditorToolbar } = await import('./EditorToolbar');
    const editor = makeEditor() as unknown as import('@tiptap/react').Editor;
    render(
      <MemoryRouter initialEntries={['/editor/x']}>
        <Routes>
          <Route path="/editor/x" element={<EditorToolbar editor={editor} plainMdMode={false} />} />
        </Routes>
      </MemoryRouter>,
    );
    const btn = screen.getByLabelText('Alternar Markdown plano');
    expect(btn).toBeDefined();
    expect(btn.getAttribute('data-active')).toBe('false');
  });

  it('TC-08: toggle button has data-active="true" when plainMdMode=true', async () => {
    const { default: EditorToolbar } = await import('./EditorToolbar');
    const editor = makeEditor() as unknown as import('@tiptap/react').Editor;
    render(
      <MemoryRouter initialEntries={['/editor/x']}>
        <Routes>
          <Route path="/editor/x" element={<EditorToolbar editor={editor} plainMdMode={true} />} />
        </Routes>
      </MemoryRouter>,
    );
    const btn = screen.getByLabelText('Alternar Markdown plano');
    expect(btn.getAttribute('data-active')).toBe('true');
  });

  it('TC-07: toggle button calls onTogglePlainMode when clicked', async () => {
    const { default: EditorToolbar } = await import('./EditorToolbar');
    const editor = makeEditor() as unknown as import('@tiptap/react').Editor;
    const onToggle = vi.fn().mockResolvedValue(undefined);
    render(
      <MemoryRouter initialEntries={['/editor/x']}>
        <Routes>
          <Route
            path="/editor/x"
            element={<EditorToolbar editor={editor} plainMdMode={false} onTogglePlainMode={onToggle} />}
          />
        </Routes>
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByLabelText('Alternar Markdown plano'));
    expect(onToggle).toHaveBeenCalledOnce();
  });
});

// ── Explain the images of this note ───────────────────────────────────────────

describe('Explicar imágenes de esta nota', () => {
  beforeEach(() => {
    useBrainStore.setState({ pendingAttachments: [], pendingPrompt: null, notices: [], messages: [] });
  });

  it('attaches local images/PDFs, fills a prompt with the note text and opens the chat', async () => {
    useEditorStore.setState({
      activeNotePath: '/vault/notas/idea.md',
      vaultPath: '/vault',
      activeNoteContent: '# Idea\n![flujo](flujo.png)\n[spec](spec.pdf)\n![web](https://x.com/a.png)',
    });
    await renderToolbar();
    fireEvent.click(screen.getByLabelText('Explicar imágenes de esta nota'));
    const s = useBrainStore.getState();
    expect(s.pendingAttachments.map((a) => a.vaultPath)).toEqual(['notas/flujo.png', 'notas/spec.pdf']);
    expect(s.pendingPrompt).toMatchObject({ send: false });
    expect(s.pendingPrompt?.text).toContain('idea');
    expect(s.pendingPrompt?.text).toContain('![flujo](flujo.png)');
    expect(s.notices.join(' ')).toMatch(/remotas/);
    expect(screen.getByTestId('brain-route')).toBeInTheDocument();
  });

  it('works on the on-disk form even when the editor holds asset URLs', async () => {
    useEditorStore.setState({
      activeNotePath: '/vault/notas/idea.md',
      vaultPath: '/vault',
      activeNoteContent: '![flujo](asset:///vault/notas/img/flujo.png)',
    });
    await renderToolbar();
    fireEvent.click(screen.getByLabelText('Explicar imágenes de esta nota'));
    expect(useBrainStore.getState().pendingAttachments.map((a) => a.vaultPath)).toEqual(['notas/img/flujo.png']);
    expect(useBrainStore.getState().pendingPrompt?.text).toContain('![flujo](img/flujo.png)');
  });

  it('opens the chat with a notice when the note has no local images or PDFs', async () => {
    useEditorStore.setState({ activeNotePath: '/vault/n.md', vaultPath: '/vault', activeNoteContent: 'solo texto' });
    await renderToolbar();
    fireEvent.click(screen.getByLabelText('Explicar imágenes de esta nota'));
    expect(useBrainStore.getState().pendingAttachments).toEqual([]);
    expect(useBrainStore.getState().notices[0]).toMatch(/no contiene imágenes/);
  });

  it('reports files beyond the limit of five', async () => {
    const md = Array.from({ length: 7 }, (_, i) => `![](i${i}.png)`).join('\n');
    useEditorStore.setState({ activeNotePath: '/vault/n.md', vaultPath: '/vault', activeNoteContent: md });
    await renderToolbar();
    fireEvent.click(screen.getByLabelText('Explicar imágenes de esta nota'));
    expect(useBrainStore.getState().pendingAttachments).toHaveLength(5);
    expect(useBrainStore.getState().notices.join(' ')).toMatch(/2 archivo\(s\) más/);
  });
});

// ── Shortcuts: tooltips, UI actions, cheat sheet ─────────────────────────────
describe('EditorToolbar shortcuts', () => {
  async function renderMac(mac: boolean, editorOverrides = {}) {
    const { default: EditorToolbar } = await import('./EditorToolbar');
    const editor = makeEditor(editorOverrides);
    render(
      <MemoryRouter initialEntries={['/editor/x']}>
        <Routes>
          <Route
            path="/editor/x"
            element={<EditorToolbar editor={editor as never} mac={mac} />}
          />
        </Routes>
      </MemoryRouter>,
    );
    return { editor };
  }

  it('shows the macOS shortcut in tooltip and aria-keyshortcuts', async () => {
    await renderMac(true);
    const bold = screen.getByLabelText('Bold');
    expect(bold.getAttribute('title')).toBe('Bold · ⌘B');
    expect(bold.getAttribute('aria-keyshortcuts')).toBe('Meta+B');
    expect(screen.getByLabelText('Strikethrough').getAttribute('title')).toBe('Strikethrough · ⇧⌘X');
  });

  it('shows Ctrl notation elsewhere', async () => {
    await renderMac(false);
    expect(screen.getByLabelText('Bold').getAttribute('title')).toBe('Bold · Ctrl+B');
    expect(screen.getByLabelText('Heading 1').getAttribute('title')).toBe('Heading 1 · Ctrl+Alt+1');
    expect(screen.getByLabelText('Bold').getAttribute('aria-keyshortcuts')).toBe('Control+B');
  });

  it('opens the table picker on the table shortcut event', async () => {
    await renderMac(false);
    expect(screen.queryByTestId('table-size-picker')).toBeNull();
    act(() => {
      window.dispatchEvent(new CustomEvent('markdaun:editor-action', { detail: { id: 'table' } }));
    });
    expect(screen.getByTestId('table-size-picker')).toBeDefined();
  });

  it('runs the link prompt on the link shortcut event', async () => {
    const prompt = vi.spyOn(window, 'prompt').mockReturnValue('https://example.com');
    const { editor } = await renderMac(false);
    act(() => {
      window.dispatchEvent(new CustomEvent('markdaun:editor-action', { detail: { id: 'link' } }));
    });
    expect(prompt).toHaveBeenCalled();
    expect(editor.chain().setLink).toHaveBeenCalledWith({ href: 'https://example.com' });
    prompt.mockRestore();
  });

  it('opens and closes the cheat sheet with Mod-/', async () => {
    await renderMac(false);
    expect(screen.queryByRole('dialog', { name: 'Atajos de teclado' })).toBeNull();
    fireEvent.keyDown(window, { key: '/', ctrlKey: true });
    expect(screen.getByRole('dialog', { name: 'Atajos de teclado' })).toBeDefined();
    fireEvent.keyDown(window, { key: '/', ctrlKey: true });
    expect(screen.queryByRole('dialog', { name: 'Atajos de teclado' })).toBeNull();
  });

  it('opens the cheat sheet from its toolbar button', async () => {
    await renderMac(true);
    fireEvent.click(screen.getByLabelText('Atajos de teclado'));
    expect(screen.getByRole('dialog', { name: 'Atajos de teclado' })).toBeDefined();
  });

  it('stays on one row without scrolling, with the cheat sheet button last', async () => {
    await renderMac(false);
    const bar = screen.getByRole('toolbar');
    expect(bar.style.flexWrap).toBe('nowrap');
    expect(bar.style.overflowX).not.toBe('auto');
    expect(bar.style.overflowX).not.toBe('scroll');
    const buttons = within(bar).getAllByRole('button');
    expect(buttons[buttons.length - 1].getAttribute('aria-label')).toBe('Atajos de teclado');
  });
});
