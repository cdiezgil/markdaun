import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { invoke } from '@tauri-apps/api/core';
import { useEditorStore } from '../store/editorStore';
import { EditorView } from './EditorView';

// Capture toggle handler and mode so tests can trigger / inspect them
let capturedToggle: (() => Promise<void>) | undefined;
let capturedPlainMdMode: boolean | undefined;

// ── Component mocks ───────────────────────────────────────────────────────────
vi.mock('../components/editor/EditorToolbar', () => ({
  default: ({
    editor,
    plainMdMode,
    onTogglePlainMode,
  }: {
    editor: unknown;
    plainMdMode?: boolean;
    onTogglePlainMode?: () => Promise<void>;
  }) => {
    capturedToggle = onTogglePlainMode;
    capturedPlainMdMode = plainMdMode;
    return (
      <div
        data-testid="editor-toolbar"
        data-has-editor={editor ? 'true' : 'false'}
        data-plain-md-mode={plainMdMode ? 'true' : 'false'}
      />
    );
  },
}));

vi.mock('../components/editor/EditorCanvas', () => ({
  default: ({
    plainMdMode,
  }: {
    onEditorReady?: (e: unknown) => void;
    plainMdMode?: boolean;
  }) =>
    plainMdMode ? (
      <div data-testid="editor-canvas">
        <textarea data-testid="plain-md-textarea" />
      </div>
    ) : (
      <div data-testid="editor-canvas">
        <div data-testid="prosemirror-editor" />
      </div>
    ),
}));

const mockInvoke = vi.mocked(invoke);

beforeEach(() => {
  vi.clearAllMocks();
  capturedToggle = undefined;
  capturedPlainMdMode = undefined;
  useEditorStore.setState({
    activeNotePath: null,
    activeNoteContent: null,
    vaultPath: '/vault',
    vaultTree: [],
    saveStatus: 'idle',
  });
});

function renderEditorView(path?: string) {
  const route = path ? `/editor/${encodeURIComponent(path)}` : '/';
  return render(
    <MemoryRouter initialEntries={[route]}>
      <Routes>
        <Route path="/editor/:encodedPath" element={<EditorView />} />
        <Route path="/" element={<EditorView />} />
      </Routes>
    </MemoryRouter>,
  );
}

// ── TC-01: renders empty state when no note active ────────────────────────────
describe('TC-01: EditorView — no active note', () => {
  it('TC-01: renders empty state div when activeNotePath is null', () => {
    renderEditorView();
    expect(screen.getByTestId('editor-empty')).toBeDefined();
  });

  it('TC-01: empty state has bg token background', () => {
    renderEditorView();
    const el = screen.getByTestId('editor-empty');
    expect(el.style.background).toBe('var(--bg)');
  });
});

// ── TC-01: renders full layout when note is active ───────────────────────────
describe('TC-01: EditorView — active note', () => {
  beforeEach(() => {
    useEditorStore.setState({ activeNotePath: '/vault/note.md' });
  });

  it('TC-01: renders toolbar', () => {
    renderEditorView('/vault/note.md');
    expect(screen.getByTestId('editor-toolbar')).toBeDefined();
  });

  it('TC-01: renders canvas', () => {
    renderEditorView('/vault/note.md');
    expect(screen.getByTestId('editor-canvas')).toBeDefined();
  });

  it('TC-01: layout wrapper is flex column', () => {
    renderEditorView('/vault/note.md');
    const wrapper = screen.getByTestId('editor-view');
    expect(wrapper.style.flexDirection).toBe('column');
  });
});

// ── TC-01 / TC-02: toggle button starts inactive ─────────────────────────────
describe('TC-01: plain-MD toggle initial state', () => {
  it('TC-01: toolbar receives plainMdMode=false initially', () => {
    useEditorStore.setState({ activeNotePath: '/vault/note.md' });
    renderEditorView('/vault/note.md');
    const toolbar = screen.getByTestId('editor-toolbar');
    expect(toolbar.getAttribute('data-plain-md-mode')).toBe('false');
  });

  it('TC-01: canvas shows prosemirror-editor initially (no plain-md-textarea)', () => {
    useEditorStore.setState({ activeNotePath: '/vault/note.md' });
    renderEditorView('/vault/note.md');
    expect(screen.getByTestId('prosemirror-editor')).toBeDefined();
    expect(screen.queryByTestId('plain-md-textarea')).toBeNull();
  });
});

// ── TC-02 / TC-03: clicking toggle enters plain mode ─────────────────────────
describe('TC-02 / TC-03: entering plain-MD mode', () => {
  beforeEach(() => {
    useEditorStore.setState({
      activeNotePath: '/vault/note.md',
      activeNoteContent: '# Hello',
    });
    // Mock saveNow so it doesn't fail
    mockInvoke.mockResolvedValue(undefined);
  });

  it('TC-02: onTogglePlainMode is provided to the toolbar', async () => {
    renderEditorView('/vault/note.md');
    expect(typeof capturedToggle).toBe('function');
  });

  it('TC-03: after toggle, canvas renders plain-md-textarea', async () => {
    renderEditorView('/vault/note.md');
    await act(async () => {
      await capturedToggle?.();
    });
    expect(screen.getByTestId('plain-md-textarea')).toBeDefined();
    expect(screen.queryByTestId('prosemirror-editor')).toBeNull();
  });

  it('TC-02: toolbar receives plainMdMode=true after toggle', async () => {
    renderEditorView('/vault/note.md');
    await act(async () => {
      await capturedToggle?.();
    });
    const toolbar = screen.getByTestId('editor-toolbar');
    expect(toolbar.getAttribute('data-plain-md-mode')).toBe('true');
  });
});

// ── TC-05 / TC-06: clicking toggle again restores WYSIWYG ────────────────────
describe('TC-05 / TC-06: returning to WYSIWYG mode', () => {
  beforeEach(() => {
    useEditorStore.setState({
      activeNotePath: '/vault/note.md',
      activeNoteContent: '# Hello',
    });
    mockInvoke.mockResolvedValue(undefined);
  });

  it('TC-05: after double toggle, canvas shows prosemirror-editor again', async () => {
    renderEditorView('/vault/note.md');
    // Enter plain mode
    await act(async () => { await capturedToggle?.(); });
    // Return to WYSIWYG
    await act(async () => { await capturedToggle?.(); });
    expect(screen.getByTestId('prosemirror-editor')).toBeDefined();
    expect(screen.queryByTestId('plain-md-textarea')).toBeNull();
  });

  it('TC-06: toolbar receives plainMdMode=false after returning to WYSIWYG', async () => {
    renderEditorView('/vault/note.md');
    await act(async () => { await capturedToggle?.(); });
    await act(async () => { await capturedToggle?.(); });
    const toolbar = screen.getByTestId('editor-toolbar');
    expect(toolbar.getAttribute('data-plain-md-mode')).toBe('false');
  });
});

// ── TC-13: mode resets when activeNotePath changes ────────────────────────────
describe('TC-13: plain-MD mode resets on note change', () => {
  it('TC-13: plainMdMode resets to false when activeNotePath changes', async () => {
    useEditorStore.setState({
      activeNotePath: '/vault/note.md',
      activeNoteContent: '# Hello',
    });
    mockInvoke.mockResolvedValue(undefined);

    renderEditorView('/vault/note.md');

    // Enter plain mode
    await act(async () => { await capturedToggle?.(); });
    expect(screen.getByTestId('plain-md-textarea')).toBeDefined();

    // Simulate note change
    await act(async () => {
      useEditorStore.setState({ activeNotePath: '/vault/other.md', activeNoteContent: '# Other' });
    });

    // Mode should have reset
    const toolbar = screen.getByTestId('editor-toolbar');
    expect(toolbar.getAttribute('data-plain-md-mode')).toBe('false');
    expect(screen.getByTestId('prosemirror-editor')).toBeDefined();
    expect(screen.queryByTestId('plain-md-textarea')).toBeNull();
  });
});

// ── TC-21: openNote called when URL param changes ─────────────────────────────
describe('TC-21: EditorView — openNote from URL param', () => {
  it('TC-21: calls openNote when filePath param is present', async () => {
    mockInvoke.mockResolvedValueOnce('# Content');
    renderEditorView('/vault/nota.md');

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith('read_note', {
        path: '/vault/nota.md',
        vaultPath: '/vault',
      });
    });
  });
});

// ── TC-21: switching notes ─────────────────────────────────────────────────────
describe('TC-21: switching active note', () => {
  it('TC-21: activeNotePath updates after openNote', async () => {
    useEditorStore.setState({ activeNotePath: '/vault/nota-a.md' });
    mockInvoke.mockResolvedValueOnce('# B contenido');

    await useEditorStore.getState().openNote('/vault/nota-b.md');

    expect(useEditorStore.getState().activeNotePath).toBe('/vault/nota-b.md');
  });
});
